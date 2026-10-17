// Speech with word times for the Mac's Premium voices (scripts/native-speech.ts compiles and runs this; ARCHITECTURE.md §4.8).
//   speech-marks <request.json> <out.wav>
// The request is {"voice": name, "lang": "zh-CN", "text": string, "marks": [UTF-16 offsets where words start]}. The WAV is the
// plain reading; stdout is {"marks": [[offset, ms], ...]}: when each marked word starts in it.
//
// A neural voice's own word events come late (two phrases late, and the last ones never come), so they are not used. A bookmark
// before each word is timed exactly, but bookmarks also slow and break up the reading, by up to a fifth on classical text. So the
// text is read twice at once, plain and with bookmarks; the plain reading is what plays, and dynamic time warping of the two
// readings' log-mel frames carries each bookmark's time over to it.
import AVFoundation
import Accelerate
import Foundation

struct Request: Decodable { let voice: String; let lang: String; let text: String; let marks: [Int] }

func fail(_ message: String, _ code: Int32) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(code)
}

let args = CommandLine.arguments
guard args.count == 3, let data = FileManager.default.contents(atPath: args[1]),
  let request = try? JSONDecoder().decode(Request.self, from: data) else { fail("usage: speech-marks <request.json> <out.wav>", 64) }
let voices = AVSpeechSynthesisVoice.speechVoices()
guard let voice = voices.first(where: { $0.name == request.voice && $0.language == request.lang })
  ?? voices.first(where: { $0.name == request.voice }) else { fail("no such voice", 65) }

let units = Array(request.text.utf16)
let marks = Array(Set(request.marks.filter { $0 >= 0 && $0 < units.count })).sorted()

func escape(_ s: String) -> String {
  s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    .replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&apos;")
}
/** The text as SSML, with a bookmark named by its index in `marks` before each marked word when `marked`. */
func ssml(marked: Bool) -> String {
  var out = "<speak>"
  var at = 0
  for (k, offset) in marks.enumerated() {
    out += escape(String(decoding: units[at..<offset], as: UTF16.self))
    if marked { out += "<mark name=\"\(k)\"/>" }
    at = offset
  }
  return out + escape(String(decoding: units[at...], as: UTF16.self)) + "</speak>"
}

final class Reading: NSObject, AVSpeechSynthesizerDelegate {
  let synth = AVSpeechSynthesizer()
  var samples: [Float] = []
  var sampleRate = 22050.0
  var bytesPerFrame = 4.0
  var finished = false
  /** Bookmark index → byte offset into the audio. */
  var bookmarks: [Int: Int] = [:]

  func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeak marker: AVSpeechSynthesisMarker, utterance: AVSpeechUtterance) {
    if marker.mark == .bookmark, let k = Int(marker.bookmarkName), bookmarks[k] == nil { bookmarks[k] = marker.byteSampleOffset }
  }

  func start(_ text: String, _ voice: AVSpeechSynthesisVoice) {
    guard let utterance = AVSpeechUtterance(ssmlRepresentation: text) else { fail("bad SSML", 66) }
    utterance.voice = voice
    synth.delegate = self
    synth.write(utterance) { buffer in
      guard let pcm = buffer as? AVAudioPCMBuffer else { return }
      if pcm.frameLength == 0 { self.finished = true; return }
      self.sampleRate = pcm.format.sampleRate
      self.bytesPerFrame = Double(pcm.format.streamDescription.pointee.mBytesPerFrame)
      if let channel = pcm.floatChannelData?[0] {
        self.samples.append(contentsOf: UnsafeBufferPointer(start: channel, count: Int(pcm.frameLength)))
      }
    }
  }
}

let plain = Reading()
let marked = marks.isEmpty ? nil : Reading()
plain.start(ssml(marked: false), voice)
marked?.start(ssml(marked: true), voice)
let deadline = Date().addingTimeInterval(25)
while !(plain.finished && (marked?.finished ?? true)) {
  if Date() > deadline { fail("timed out", 67) }
  RunLoop.main.run(until: Date().addingTimeInterval(0.01))
}
if plain.samples.isEmpty { fail("no audio", 68) }

// ---- the plain reading as 16-bit mono WAV
func wav(_ samples: [Float], _ rate: Int) -> Data {
  var d = Data()
  func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
  func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
  let bytes = UInt32(samples.count * 2)
  d.append(contentsOf: Array("RIFF".utf8)); u32(36 + bytes); d.append(contentsOf: Array("WAVEfmt ".utf8))
  u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
  d.append(contentsOf: Array("data".utf8)); u32(bytes)
  d.reserveCapacity(d.count + samples.count * 2)
  for s in samples { u16(UInt16(bitPattern: Int16(max(-1, min(1, s)) * 32767))) }
  return d
}
guard FileManager.default.createFile(atPath: args[2], contents: wav(plain.samples, Int(plain.sampleRate))) else { fail("could not write", 73) }

// ---- word times
let hop = 0.01
/** Log-mel energies (24 bands, 80 Hz–7 kHz) of 512-sample frames every 10 ms. */
func features(_ x: [Float], _ rate: Double) -> [[Float]] {
  let n = 512, log2n = vDSP_Length(9), bands = 24
  guard let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else { return [] }
  defer { vDSP_destroy_fftsetup(setup) }
  var window = [Float](repeating: 0, count: n)
  vDSP_hann_window(&window, vDSP_Length(n), Int32(vDSP_HANN_NORM))
  func mel(_ f: Double) -> Double { 2595 * log10(1 + f / 700) }
  func hz(_ m: Double) -> Double { 700 * (pow(10, m / 2595) - 1) }
  var edges: [Int] = []
  for e in 0...(bands + 1) {
    let m: Double = mel(80) + (mel(7000) - mel(80)) * Double(e) / Double(bands + 1)
    edges.append(Int(hz(m) / rate * Double(n)))
  }
  let step = max(1, Int(rate * hop))
  var frame = [Float](repeating: 0, count: n)
  var re = [Float](repeating: 0, count: n / 2), im = [Float](repeating: 0, count: n / 2)
  var power = [Float](repeating: 0, count: n / 2)
  var out: [[Float]] = []
  for start in stride(from: 0, to: x.count, by: step) {
    for i in 0..<n { frame[i] = start + i < x.count ? x[start + i] * window[i] : 0 }
    re.withUnsafeMutableBufferPointer { r in
      im.withUnsafeMutableBufferPointer { m in
        var split = DSPSplitComplex(realp: r.baseAddress!, imagp: m.baseAddress!)
        frame.withUnsafeBufferPointer { f in
          f.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: n / 2) { vDSP_ctoz($0, 2, &split, 1, vDSP_Length(n / 2)) }
        }
        vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
        vDSP_zvmags(&split, 1, &power, 1, vDSP_Length(n / 2))
      }
    }
    var v = [Float](repeating: 0, count: bands)
    for b in 0..<bands {
      let lo = edges[b], mid = max(edges[b + 1], lo + 1), hi = max(edges[b + 2], mid + 1)
      var s: Float = 0
      for k in lo..<min(hi, n / 2) { s += power[k] * (k < mid ? Float(k - lo) / Float(mid - lo) : Float(hi - k) / Float(hi - mid)) }
      v[b] = log(s + 1e-6)
    }
    out.append(v)
  }
  return out
}

/** For each frame of `a`, the first frame of `b` the warping path pairs it with (banded around the diagonal). */
func warp(_ a: [[Float]], _ b: [[Float]]) -> [Int] {
  let n = a.count, m = b.count
  if n == 0 || m == 0 { return [] }
  let band = abs(n - m) + max(50, max(n, m) / 10)
  let width = 2 * band + 1
  // Row i holds columns center(i) - band ... center(i) + band.
  func center(_ i: Int) -> Int { i * m / n }
  var cost = [Float](repeating: .infinity, count: n * width)
  var step = [UInt8](repeating: 0, count: n * width)
  func at(_ i: Int, _ j: Int) -> Float {
    if i < 0 || j < 0 { return i < 0 && j < 0 ? 0 : .infinity }
    let k = j - center(i) + band
    return k >= 0 && k < width ? cost[i * width + k] : .infinity
  }
  for i in 0..<n {
    let c = center(i)
    for j in max(0, c - band)...min(m - 1, c + band) {
      var d: Float = 0
      for k in 0..<a[i].count { let e = a[i][k] - b[j][k]; d += e * e }
      let diag = at(i - 1, j - 1), up = at(i - 1, j), left = at(i, j - 1)
      let k = j - c + band
      if diag <= up && diag <= left { cost[i * width + k] = d.squareRoot() + diag; step[i * width + k] = 0 }
      else if up <= left { cost[i * width + k] = d.squareRoot() + up; step[i * width + k] = 1 }
      else { cost[i * width + k] = d.squareRoot() + left; step[i * width + k] = 2 }
    }
  }
  var first = [Int](repeating: m - 1, count: n)
  var i = n - 1, j = m - 1
  while i >= 0 && j >= 0 {
    first[i] = j
    let k = j - center(i) + band
    if k < 0 || k >= width { break }
    switch step[i * width + k] { case 0: i -= 1; j -= 1; case 1: i -= 1; default: j -= 1 }
  }
  return first
}

var times: [[Int]] = []
if let marked, !marked.bookmarks.isEmpty {
  let path = warp(features(marked.samples, marked.sampleRate), features(plain.samples, plain.sampleRate))
  var last = 0
  for (k, offset) in marks.enumerated() {
    guard let bytes = marked.bookmarks[k], !path.isEmpty else { continue }
    let frame = min(path.count - 1, Int(Double(bytes) / marked.bytesPerFrame / marked.sampleRate / hop))
    last = max(last, Int((Double(path[frame]) * hop * 1000).rounded()))
    times.append([offset, last])
  }
}
let json = try! JSONSerialization.data(withJSONObject: ["marks": times])
FileHandle.standardOutput.write(json)
