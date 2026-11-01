import Foundation
import Vision
import ImageIO

let args = CommandLine.arguments
let root = args.count > 1 ? args[1] : "data"
let fm = FileManager.default
let rootURL = URL(fileURLWithPath: root)
func textFor(_ url: URL) -> String {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return "" }
    let req = VNRecognizeTextRequest()
    req.recognitionLanguages = ["zh-Hans", "en-US"]
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do { try handler.perform([req]) } catch { return "" }
    return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}
for platform in ["xhs", "xianyu"] {
    let dir = rootURL.appendingPathComponent(platform)
    guard let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil).filter({ $0.pathExtension == "json" }) else { continue }
    for f in files {
        guard let data = try? Data(contentsOf: f), var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String:Any], let id = obj["id"] as? String else { continue }
        let imgs = (obj["images"] as? [String]) ?? []
        var text = ""
        if let first = imgs.first { text = textFor(URL(fileURLWithPath: first)) }
        if text.isEmpty { text = (obj["title"] as? String) ?? "" }
        obj["cover_ocr"] = text
        if let out = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]), let outStr = String(data: out, encoding: .utf8) { try? (outStr + "\n").write(to: f, atomically: true, encoding: .utf8) }
        print("\(platform) \(id) \(text.prefix(80))")
    }
}
