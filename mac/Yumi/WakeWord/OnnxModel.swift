import Foundation
@preconcurrency import OnnxRuntimeBindings

/// One ONNX model with one float input and one float output, through ONNX Runtime (OBJ-16.1).
/// Runs on one thread, the way openWakeWord runs it, so idle listening stays light.
nonisolated final class OnnxModel: TensorModel {
    /// One environment for every model; ORTEnv is thread-safe.
    nonisolated(unsafe) private static let environment = Result { try ORTEnv(loggingLevel: .warning) }

    private let session: ORTSession
    private let inputName: String
    private let outputName: String

    init(contentsOf url: URL) throws {
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(1)
        session = try ORTSession(env: Self.environment.get(), modelPath: url.path, sessionOptions: options)
        inputName = try session.inputNames().first ?? "input"
        outputName = try session.outputNames().first ?? "output"
    }

    func run(_ input: [Float], shape: [Int]) throws -> [Float] {
        let data = input.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Float>.size) }
        let tensor = try ORTValue(tensorData: data, elementType: .float, shape: shape.map { NSNumber(value: $0) })
        let outputs = try session.run(withInputs: [inputName: tensor], outputNames: [outputName], runOptions: nil)
        guard let output = try outputs[outputName]?.tensorData() else { return [] }
        let count = output.length / MemoryLayout<Float>.size
        return [Float](unsafeUninitializedCapacity: count) { buffer, initialized in
            output.getBytes(buffer.baseAddress!, length: count * MemoryLayout<Float>.size)
            initialized = count
        }
    }
}
