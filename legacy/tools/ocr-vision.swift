import Foundation
import Vision
import AppKit

// Minimal OCR CLI: prints recognised text lines, one per line.
// Usage: ocr-vision <image-path>

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write(Data("usage: ocr-vision <image>\n".utf8))
    exit(2)
}

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cgImage = bitmap.cgImage else {
    FileHandle.standardError.write(Data("could not load image\n".utf8))
    exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write(Data("ocr failed: \(error)\n".utf8))
    exit(4)
}

let observations = request.results ?? []
for obs in observations {
    if let candidate = obs.topCandidates(1).first {
        let box = obs.boundingBox
        // Emit "text\tx\ty\tw\th" so the caller can use layout when parsing.
        print("\(candidate.string)\t\(box.origin.x)\t\(box.origin.y)\t\(box.size.width)\t\(box.size.height)")
    }
}
