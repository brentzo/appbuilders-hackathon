import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics
import Observation
import OSLog

/// Reads the system's permission state for the probes `PermissionCenter` uses. A protocol so
/// tests can drive `PermissionCenter` without touching the real privacy database.
protocol PermissionSystem {
    func state(of permission: Permission) -> PermissionState
    /// Asks macOS for the permission. For the microphone this shows macOS's Allow prompt and
    /// returns once the user answers. For Accessibility and Screen Recording it adds Yumi to the
    /// list in System Settings (macOS may show its own notice the first time).
    func request(_ permission: Permission) async
    func open(_ url: URL)
}

struct MacPermissionSystem: PermissionSystem {
    func state(of permission: Permission) -> PermissionState {
        switch permission {
        case .microphone:
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized: .granted
            case .notDetermined: .notAsked
            default: .missing
            }
        case .accessibility:
            AXIsProcessTrusted() ? .granted : .missing
        case .screenRecording:
            CGPreflightScreenCaptureAccess() ? .granted : .missing
        }
    }

    func request(_ permission: Permission) async {
        switch permission {
        case .microphone:
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        case .accessibility:
            // The string value of kAXTrustedCheckOptionPrompt, which Swift 6 cannot read safely.
            _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        case .screenRecording:
            _ = CGRequestScreenCaptureAccess()
        }
    }

    func open(_ url: URL) {
        NSWorkspace.shared.open(url)
    }
}

/// Tracks the three permissions and notices grants while Yumi runs.
///
/// macOS posts no notification when a privacy permission changes, so this checks again:
/// - every second, only while the onboarding window is open (`startPolling`),
/// - whenever Yumi becomes active (`observeActivation`),
/// - right before a task needs a permission (`check`).
///
/// Microphone and Accessibility update live. Screen Recording may only report a grant after Yumi
/// restarts; System Settings offers "Quit & Reopen" for that.
@Observable
final class PermissionCenter {
    private(set) var states: [Permission: PermissionState] = [:]

    @ObservationIgnored private let system: PermissionSystem
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var activationObserver: NSObjectProtocol?
    @ObservationIgnored private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "permissions")

    init(system: PermissionSystem = MacPermissionSystem(), defaults: UserDefaults = .standard) {
        self.system = system
        self.defaults = defaults
        refresh()
    }

    var missing: [Permission] {
        Permission.allCases.filter { state(of: $0) != .granted }
    }

    var allGranted: Bool { missing.isEmpty }

    func state(of permission: Permission) -> PermissionState {
        states[permission] ?? .missing
    }

    func refresh() {
        var next: [Permission: PermissionState] = [:]
        for permission in Permission.allCases {
            next[permission] = system.state(of: permission)
        }
        guard next != states else { return }
        for permission in Permission.allCases where states[permission] != next[permission] {
            log.info("\(permission.rawValue, privacy: .public) is now \(String(describing: next[permission]!), privacy: .public)")
        }
        states = next
    }

    /// The current state, read from macOS now. Call this right before work that needs the permission.
    func check(_ permission: Permission) -> PermissionState {
        refresh()
        return state(of: permission)
    }

    /// Re-checks whenever Yumi becomes active, for the life of the app.
    func observeActivation() {
        guard activationObserver == nil else { return }
        activationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
    }

    var isPolling: Bool { timer != nil }

    /// Re-checks every second. Only for while the onboarding window is open, where the user is
    /// flipping switches in System Settings and expects Yumi to notice.
    func startPolling() {
        guard timer == nil else { return }
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    /// What "Open settings" does.
    ///
    /// - Microphone never asked: show macOS's Allow prompt instead, because System Settings does
    ///   not list an app for the microphone until macOS has asked once.
    /// - Accessibility and Screen Recording: the first time, ask macOS to add Yumi to the list,
    ///   then open the pane so the user only has to flip the switch.
    /// - Otherwise: open the pane.
    func openSettings(for permission: Permission) async {
        switch permission {
        case .microphone where state(of: .microphone) == .notAsked:
            await system.request(.microphone)
            refresh()
            return
        case .accessibility, .screenRecording:
            let key = "permissions.requested.\(permission.rawValue)"
            if !defaults.bool(forKey: key) {
                defaults.set(true, forKey: key)
                await system.request(permission)
            }
        case .microphone:
            break
        }
        system.open(permission.settingsURL)
    }
}
