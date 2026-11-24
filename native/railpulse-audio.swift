import Foundation
import ScreenCaptureKit
import CoreMedia
import Accelerate

let BANDS = 46
let FFT_N = 512
let LOG2N = vDSP_Length(9)

final class Grabber: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "railpulse.audio")
    private var fftSetup: FFTSetup?
    private var window: [Float] = []
    private var frameCount = 0
    private var bandMax = [Float](repeating: -80, count: BANDS)

    override init() {
        super.init()
        fftSetup = vDSP_create_fftsetup(LOG2N, FFTRadix(FFT_RADIX2))
        window = [Float](repeating: 0, count: FFT_N)
        vDSP_hann_window(&window, vDSP_Length(FFT_N), Int32(vDSP_HANN_NORM))
    }

    deinit { if let s = fftSetup { vDSP_destroy_fftsetup(s) } }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw NSError(domain: "railpulse", code: 1, userInfo: [NSLocalizedDescriptionKey: "no display"])
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.sampleRate = 44100
        cfg.channelCount = 1
        cfg.excludesCurrentProcessAudio = true
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 2)
        let s = SCStream(filter: filter, configuration: cfg, delegate: nil)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await s.startCapture()
        stream = s
        FileHandle.standardError.write("started\n".data(using: .utf8)!)
    }

    func stop() { stream?.stopCapture(completionHandler: nil) }

    private func analyze(_ samples: UnsafePointer<Float>, _ count: Int) {
        var buf = [Float](repeating: 0, count: FFT_N)
        let n = min(count, FFT_N)
        buf.withUnsafeMutableBufferPointer { dst in
            dst.baseAddress!.update(from: samples, count: n)
        }
        vDSP_vmul(buf, 1, window, 1, &buf, 1, vDSP_Length(FFT_N))

        var real = [Float](repeating: 0, count: FFT_N/2)
        var imag = [Float](repeating: 0, count: FFT_N/2)
        var mags = [Float](repeating: 0, count: FFT_N/2)
        real.withUnsafeMutableBufferPointer { rp in
            imag.withUnsafeMutableBufferPointer { ip in
                var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                buf.withUnsafeBufferPointer { p in
                    p.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: FFT_N/2) { cp in
                        vDSP_ctoz(cp, 2, &split, 1, vDSP_Length(FFT_N/2))
                    }
                }
                vDSP_fft_zrip(fftSetup!, &split, 1, LOG2N, FFTDirection(FFT_FORWARD))
                mags.withUnsafeMutableBufferPointer { mp in
                    vDSP_zvabs(&split, 1, mp.baseAddress!, 1, vDSP_Length(FFT_N/2))
                }
            }
        }
        var bands = [Float](repeating: 0, count: BANDS)
        let maxBin = FFT_N/2 - 1
        for i in 0..<BANDS {
            let t0 = pow(Float(i) / Float(BANDS), 2.2)
            let t1 = pow(Float(i + 1) / Float(BANDS), 2.2)
            let b0 = max(1, min(maxBin, Int(t0 * Float(maxBin))))
            let b1 = max(b0 + 1, min(maxBin, Int(t1 * Float(maxBin)) + 1))
            var sum: Float = 0
            for b in b0..<b1 { sum += mags[b] }
            let avg = sum / Float(b1 - b0)
            let db = 20 * log10(max(avg, 1e-7))
            bandMax[i] = max(db, bandMax[i] - 0.35)
            let floor = bandMax[i] - 26
            var norm = (db - floor) / 26
            if bandMax[i] < -60 { norm = 0 }
            bands[i] = max(0, min(1, pow(max(0, norm), 0.9)))
        }
        if bands.count >= 3 {
            var sm = bands
            for i in 1..<(bands.count - 1) {
                sm[i] = bands[i] * 0.6 + bands[i-1] * 0.2 + bands[i+1] * 0.2
            }
            bands = sm
        }
        frameCount += 1
        if frameCount % 2 == 0 {
            if let data = try? JSONSerialization.data(withJSONObject: ["bands": bands, "t": Date().timeIntervalSince1970]) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write("\n".data(using: .utf8)!)
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        var abl = AudioBufferList()
        var block: CMBlockBuffer?
        let st = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &abl,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &block)
        guard st == noErr, let data = abl.mBuffers.mData else { return }
        let count = Int(abl.mBuffers.mDataByteSize) / MemoryLayout<Float>.size
        analyze(data.assumingMemoryBound(to: Float.self), count)
    }
}

let grabber = Grabber()
Task {
    do {
        try await grabber.start()
    } catch {
        FileHandle.standardError.write(("error: \(error.localizedDescription)\n").data(using: .utf8)!)
        exit(2)
    }
}
RunLoop.main.run()
