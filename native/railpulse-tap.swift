import Cocoa
import CoreAudio
import Accelerate

let BANDS = 46
let FFT_N = 512
let log2n = vDSP_Length(9)

final class TapCapture {
    var tapID = AudioObjectID(kAudioObjectUnknown)
    var aggID = AudioObjectID(kAudioObjectUnknown)
    var procID: AudioDeviceIOProcID?
    let fft: FFTSetup
    let window: [Float]
    var bandMax = [Float](repeating: -80, count: BANDS)
    var lastEmit = CFAbsoluteTimeGetCurrent()
    var cbCount = 0

    init() {
        fft = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
        var w = [Float](repeating: 0, count: FFT_N)
        vDSP_hann_window(&w, vDSP_Length(FFT_N), Int32(vDSP_HANN_NORM))
        window = w
    }

    func start() -> Bool {
        let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        desc.uuid = UUID()
        desc.isPrivate = true
        desc.muteBehavior = .unmuted
        var err = AudioHardwareCreateProcessTap(desc, &tapID)
        fputs("tap id=\(tapID) err=\(err)\n", stderr)
        if err != noErr { return false }
        let aggUID = UUID().uuidString
        let sub: [String: Any] = [
            kAudioSubTapUIDKey: desc.uuid.uuidString,
            kAudioSubTapDriftCompensationKey: true
        ]
        let agg: [String: Any] = [
            kAudioAggregateDeviceNameKey: "RailPulseTap",
            kAudioAggregateDeviceUIDKey: aggUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapListKey: [sub],
            kAudioAggregateDeviceSubDeviceListKey: [],
            kAudioAggregateDeviceMainSubDeviceKey: ""
        ]
        err = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID)
        fputs("agg id=\(aggID) err=\(err)\n", stderr)
        if err != noErr { return false }
        err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { [weak self] _, inData, _, _, _ in
            self?.handle(inData)
        }
        if err != noErr { fputs("ioproc err \(err)\n", stderr); return false }
        err = AudioDeviceStart(aggID, procID)
        fputs("start err=\(err)\n", stderr)
        if err != noErr { return false }
        fputs("RUNNING\n", stderr)
        return true
    }

    func handle(_ inData: UnsafePointer<AudioBufferList>) {
        let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
        guard let buf = abl.first, let mData = buf.mData else { return }
        let n = Int(buf.mDataByteSize) / MemoryLayout<Float>.size
        if n < FFT_N { return }
        var samples = [Float](repeating: 0, count: FFT_N)
        let p = mData.assumingMemoryBound(to: Float.self)
        for i in 0..<FFT_N { samples[i] = p[i] * window[i] }
        var real = [Float](repeating: 0, count: FFT_N/2)
        var imag = [Float](repeating: 0, count: FFT_N/2)
        var mag = [Float](repeating: 0, count: FFT_N/2)
        real.withUnsafeMutableBufferPointer { rp in
            imag.withUnsafeMutableBufferPointer { ip in
                var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                samples.withUnsafeBufferPointer { sp in
                    sp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: FFT_N/2) { cp in
                        vDSP_ctoz(cp, 2, &split, 1, vDSP_Length(FFT_N/2))
                    }
                }
                vDSP_fft_zrip(fft, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvabs(&split, 1, &mag, 1, vDSP_Length(FFT_N/2))
            }
        }
        var scale: Float = 1.0 / Float(FFT_N)
        vDSP_vsmul(mag, 1, &scale, &mag, 1, vDSP_Length(FFT_N/2))
        let now = CFAbsoluteTimeGetCurrent()
        if now - lastEmit < 0.06 { return }
        lastEmit = now
        cbCount += 1
        var bands = [Float](repeating: 0, count: BANDS)
        for i in 0..<BANDS {
            let t0 = pow(Double(i) / Double(BANDS), 2.2)
            let t1 = pow(Double(i+1) / Double(BANDS), 2.2)
            let b0 = max(1, min(FFT_N/2 - 1, Int(t0 * Double(FFT_N/2))))
            let b1 = max(b0+1, min(FFT_N/2, Int(t1 * Double(FFT_N/2))))
            var sum: Float = 0
            for b in b0..<b1 { sum += mag[b] }
            let avg = sum / Float(b1 - b0)
            let db = 20 * log10(max(avg, 1e-7))
            bandMax[i] = max(db, bandMax[i] - 0.35)
            let floor = bandMax[i] - 26
            var norm = (db - floor) / 26
            if bandMax[i] < -60 { norm = 0 }
            bands[i] = max(0, min(1, pow(max(0, norm), 0.9)))
        }
        let bn = bands.count
        if bn >= 3 {
            var sm = bands
            for i in 1..<(bn - 1) {
                sm[i] = bands[i] * 0.5 + bands[i-1] * 0.25 + bands[i+1] * 0.25
            }
            bands = sm
            var filled = bands
            for i in 0..<bn {
                let lo = max(0, i - 2), hi = min(bn - 1, i + 2)
                var local: Float = 0
                for j in lo...hi where j != i { local = max(local, bands[j]) }
                if bands[i] < local * 0.12 { filled[i] = max(filled[i], local * 0.22) }
            }
            // interpolate across runs of near-empty bands
            var i = 1
            while i < bn - 1 {
                if filled[i] < 0.12 {
                    var j = i
                    while j < bn - 1 && filled[j] < 0.12 { j += 1 }
                    let a = filled[i-1], b = filled[j]
                    for k in i..<j {
                        let t = Float(k - i + 1) / Float(j - i + 1)
                        filled[k] = max(filled[k], (a + (b - a) * t) * 0.85)
                    }
                    i = j
                } else { i += 1 }
            }
            bands = filled
        }
        let payload: [String: Any] = ["bands": bands, "t": Date().timeIntervalSince1970]
        if let data = try? JSONSerialization.data(withJSONObject: payload), let s = String(data: data, encoding: .utf8) {
            print(s); fflush(stdout)
        }
    }
}

let cap = TapCapture()
if !cap.start() { fputs("FAILED\n", stderr); exit(1) }
RunLoop.main.run()
