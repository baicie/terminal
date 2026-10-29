import ApplicationServices
import Foundation

private let maxElements = 100_000
private let maxDepth = 32
private var accessibilityAPIIsDisabled = false

private func attributeString(_ element: AXUIElement, _ attribute: CFString) -> String {
    var rawValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &rawValue) == .success,
          let rawValue else {
        return ""
    }
    if let value = rawValue as? String {
        return value
    }
    if let value = rawValue as? NSNumber {
        return value.stringValue
    }
    return ""
}

private func attributeElements(_ element: AXUIElement, _ attribute: CFString) -> [AXUIElement] {
    var rawValue: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute, &rawValue)
    if error == .apiDisabled {
        accessibilityAPIIsDisabled = true
    }
    guard error == .success,
          let rawValue else {
        return []
    }
    return (rawValue as? [AXUIElement]) ?? []
}

private struct Readiness {
    var localTab = false
    var connected = false
    var terminalInput = false
    var shellPrompt = false

    var isComplete: Bool {
        localTab && connected && terminalInput && shellPrompt
    }
}

private func inspect(
    _ element: AXUIElement,
    depth: Int,
    count: inout Int,
    readiness: inout Readiness
) {
    guard depth <= maxDepth, count < maxElements, !readiness.isComplete else {
        return
    }
    count += 1

    let name = attributeString(element, kAXTitleAttribute as CFString)
    let description = attributeString(element, kAXDescriptionAttribute as CFString)
    let value = attributeString(element, kAXValueAttribute as CFString)
    let role = attributeString(element, kAXRoleAttribute as CFString)
    let roleDescription = attributeString(element, kAXRoleDescriptionAttribute as CFString)
    let haystack = "\(name) \(description) \(value) \(role) \(roleDescription)"

    if haystack.contains("Local") || haystack.contains("本地终端") {
        readiness.localTab = true
    }
    if haystack.contains("Connected") || haystack.contains("已连接") {
        readiness.connected = true
    }
    let isTextInput = role.contains("AXTextField") ||
        role.contains("AXTextArea") ||
        roleDescription.localizedCaseInsensitiveContains("text field") ||
        roleDescription.localizedCaseInsensitiveContains("text area")
    if isTextInput && (haystack.contains("Terminal input") || haystack.contains("xterm input")) {
        readiness.terminalInput = true
    }
    if haystack.contains("zsh") || haystack.contains("% ") || haystack.contains("~%") {
        readiness.shellPrompt = true
    }

    let children = attributeElements(element, kAXChildrenAttribute as CFString)
    for child in children {
        inspect(child, depth: depth + 1, count: &count, readiness: &readiness)
        if readiness.isComplete {
            return
        }
    }
}

private func probe(pid: pid_t) -> Readiness {
    let application = AXUIElementCreateApplication(pid)
    var readiness = Readiness()
    var count = 0
    for window in attributeElements(application, kAXWindowsAttribute as CFString) {
        inspect(window, depth: 0, count: &count, readiness: &readiness)
        if readiness.isComplete {
            break
        }
    }
    return readiness
}

guard CommandLine.arguments.count == 2, let rawPid = Int32(CommandLine.arguments[1]) else {
    FileHandle.standardError.write(Data("usage: macos-ax-probe <pid>\n".utf8))
    exit(64)
}

private let readiness = probe(pid: pid_t(rawPid))
if accessibilityAPIIsDisabled {
    FileHandle.standardError.write(Data("Accessibility API is disabled for this process\n".utf8))
    exit(77)
}
let flags = [
    readiness.localTab,
    readiness.connected,
    readiness.terminalInput,
    readiness.shellPrompt,
].map { $0 ? "1" : "0" }.joined(separator: ",")
print(flags)
