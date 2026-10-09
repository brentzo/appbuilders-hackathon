// Records the default microphone to a 16 kHz mono 16-bit WAV until a line arrives on stdin.
// Built and run by record.py; uses only Apple frameworks, so nothing needs installing.
import AVFoundation
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("usage: recorder <output.wav> | recorder --check\n".data(using: .utf8)!)
    exit(64)
}

func microphoneAllowed() -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return true
    case .notDetermined:
        let done = DispatchSemaphore(value: 0)
        var granted = false
        AVCaptureDevice.requestAccess(for: .audio) { granted = $0; done.signal() }
        done.wait()
        return granted
    default: return false
    }
}

guard microphoneAllowed() else {
    print("NO_MIC_PERMISSION")
    exit(3)
}

let device = AVCaptureDevice.default(for: .audio)?.localizedName ?? "unknown microphone"
if CommandLine.arguments[1] == "--check" {
    print("MIC \(device)")
    exit(0)
}

let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM,
    AVSampleRateKey: 16_000,
    AVNumberOfChannelsKey: 1,
    AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false,
    AVLinearPCMIsBigEndianKey: false,
]
let recorder: AVAudioRecorder
do {
    recorder = try AVAudioRecorder(url: URL(fileURLWithPath: CommandLine.arguments[1]), settings: settings)
} catch {
    print("RECORDER_FAILED \(error.localizedDescription)")
    exit(4)
}
guard recorder.record() else {
    print("RECORDER_FAILED could not start")
    exit(4)
}
print("RECORDING", terminator: "\n")
fflush(stdout)
_ = readLine()
let seconds = recorder.currentTime
recorder.stop()
print(String(format: "STOPPED %.1f", seconds))
