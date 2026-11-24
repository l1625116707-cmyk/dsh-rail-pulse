#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
swiftc -O native/railpulse-audio.swift -o bin/railpulse-audio
echo "built bin/railpulse-audio"
