import Foundation
import Vision
import ImageIO

// First positional argument remains the data root; it now contains posts.jsonl.
let args = CommandLine.arguments
let root = args.count > 1 ? args[1] : "data"
let dataset = URL(fileURLWithPath: root).appendingPathComponent("posts.jsonl")
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
// Read-only batch mode for account imports; no production JSONL is rewritten.
if args.count > 2 && args[1] == "--images-json" {
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: args[2]))
        let paths = try JSONSerialization.jsonObject(with: data) as? [String] ?? []
        var result: [String: String] = [:]
        for path in paths { result[path] = textFor(URL(fileURLWithPath: path)) }
        let encoded = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        print(String(decoding: encoded, as: UTF8.self))
        exit(0)
    } catch { fputs("只读OCR失败：\(error)\n", stderr); exit(1) }
}
do {
    let raw = try String(contentsOf: dataset, encoding: .utf8)
    var records: [[String: Any]] = []
    var seen = Set<String>()
    // Validate every row before doing any write; malformed data never disappears.
    for line in raw.split(separator: "\n") {
        let value = try JSONSerialization.jsonObject(with: Data(line.utf8))
        guard let obj = value as? [String: Any], let id = obj["id"] as? String,
              obj["platform"] is String, seen.insert(id).inserted else {
            throw NSError(domain: "content-ops", code: 1, userInfo: [NSLocalizedDescriptionKey: "帖子 id/platform 无效或重复"])
        }
        records.append(obj)
    }
    records.sort { (($0["platform"] as! String), ($0["id"] as! String)) < (($1["platform"] as! String), ($1["id"] as! String)) }
    var output = ""
    for var obj in records {
        let imgs = (obj["images"] as? [String]) ?? []
        var text = ""
        if let first = imgs.first { text = textFor(URL(fileURLWithPath: first)) }
        if text.isEmpty { text = (obj["title"] as? String) ?? "" }
        obj["cover_ocr"] = text
        let encoded = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .withoutEscapingSlashes])
        output += String(decoding: encoded, as: UTF8.self) + "\n"
        print("\(obj["platform"]!) \(obj["id"]!) \(text.prefix(80))")
    }
    try output.write(to: dataset, atomically: true, encoding: .utf8)
} catch {
    fputs("OCR 未写入：\(error)\n", stderr)
    exit(1)
}
