// Lists the words macOS's spell checker does not know, with counts: swift spellcheck.swift <lang> <file.md>
// Used to catch OCR slips in Wikisource-sourced texts (names show up too; read the list, do not auto-fix).
import AppKit
let args = CommandLine.arguments
let lang = args[1]
let text = try! String(contentsOfFile: args[2], encoding: .utf8)
let checker = NSSpellChecker.shared
checker.setLanguage(lang)
let tag = NSSpellChecker.uniqueSpellDocumentTag()
var counts: [String: Int] = [:]
var pos = 0
let ns = text as NSString
while pos < ns.length {
    let r = checker.checkSpelling(of: text, startingAt: pos, language: lang, wrap: false, inSpellDocumentWithTag: tag, wordCount: nil)
    if r.location == NSNotFound { break }
    counts[ns.substring(with: r), default: 0] += 1
    pos = r.location + r.length
}
for (w, c) in counts.sorted(by: { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }) { print("\(c)\t\(w)") }
