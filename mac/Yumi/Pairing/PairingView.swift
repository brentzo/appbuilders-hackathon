import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

/// The pairing screen (OBJ-27.5, SPEC-08 r1): a QR code the phone scans, then "Paired with
/// <device name>".
struct PairingView: View {
    let phone: PhoneLink
    let close: () -> Void

    var body: some View {
        VStack(spacing: YumiSpace.l) {
            if let device = phone.pairedDevice {
                YumiBadge(size: 64)
                Text("Paired with \(device.name)")
                    .font(YumiFont.headline)
                    .foregroundStyle(YumiColor.brand)
                Button("Done", action: close)
                    .buttonStyle(YumiPrimaryButtonStyle())
                    .keyboardShortcut(.defaultAction)
            } else if let code = phone.pairingCode {
                Text("Scan this code with Yumi on your phone")
                    .font(YumiFont.headline)
                    .foregroundStyle(YumiColor.brand)
                    .multilineTextAlignment(.center)
                // Always light behind the code, in dark mode too, so every phone camera reads it.
                QRCodeImage(payload: code.payload)
                    .frame(width: 220, height: 220)
                    .padding(YumiSpace.m)
                    .background(Self.codeBackground, in: RoundedRectangle(cornerRadius: YumiRadius.panel, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: YumiRadius.panel, style: .continuous).strokeBorder(YumiColor.line))
                    .accessibilityLabel("Pairing code")
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Group {
                        if context.date < code.expiresAt {
                            Text("The code works for \(Self.remaining(until: code.expiresAt, from: context.date)).")
                                .monospacedDigit()
                        } else {
                            Text("This code expired.")
                        }
                    }
                    .font(YumiFont.body)
                    .foregroundStyle(YumiColor.muted)
                }
                HStack(spacing: YumiSpace.s) {
                    Button("Cancel") {
                        phone.cancelPairing()
                        close()
                    }
                    .buttonStyle(YumiSecondaryButtonStyle())
                    .keyboardShortcut(.cancelAction)
                    Button("New code") { phone.startPairing() }
                        .buttonStyle(YumiSecondaryButtonStyle())
                }
            } else {
                ProgressView()
                    .controlSize(.large)
                Text("Getting a pairing code…")
                    .font(YumiFont.body)
                    .foregroundStyle(YumiColor.muted)
            }
        }
        .padding(YumiSpace.xxl)
        .frame(width: 360)
        .yumiWindow()
        .fixedSize(horizontal: false, vertical: true)
        .task {
            if phone.pairedDevice == nil, phone.pairingCode == nil { phone.startPairing() }
            // The harness reports a new pairing through bridgeStateChanged; this also notices it
            // if that event is missed.
            while !Task.isCancelled, phone.pairedDevice == nil {
                try? await Task.sleep(for: .seconds(2))
                phone.refreshDevices()
            }
        }
    }

    /// The paper of the light theme, fixed.
    static let codeBackground = Color(red: 0xFF / 255, green: 0xFD / 255, blue: 0xF6 / 255)

    static func remaining(until end: Date, from now: Date) -> String {
        let seconds = max(0, Int(end.timeIntervalSince(now).rounded()))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// A sharp QR code for the pairing window.
struct QRCodeImage: View {
    let payload: String

    var body: some View {
        if let image = Self.render(payload) {
            Image(nsImage: image)
                .interpolation(.none)
                .resizable()
                .aspectRatio(contentMode: .fit)
        } else {
            Image(systemName: "qrcode")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .foregroundStyle(.black)
        }
    }

    static func render(_ payload: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        // Scaled up here, with whole-pixel modules: SwiftUI smooths a small image however it is drawn.
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 16, y: 16)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return NSImage(cgImage: cgImage, size: output.extent.size)
    }
}

/// Opens the pairing window, one at a time.
@MainActor
enum PairingWindow {
    private static var window: NSWindow?

    @discardableResult
    static func show(phone: PhoneLink = .shared) -> NSWindow {
        if let window {
            NSApp.activate()
            window.makeKeyAndOrderFront(nil)
            return window
        }
        let created = NSWindow(contentViewController: NSHostingController(rootView: PairingView(phone: phone) {
            PairingWindow.window?.close()
        }))
        created.title = "Pair your phone"
        created.styleMask = [.titled, .closable]
        created.isReleasedWhenClosed = false
        created.applyYumiStyle()
        created.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: created, queue: .main) { _ in
            MainActor.assumeIsolated {
                if phone.pairedDevice == nil { phone.cancelPairing() }
                PairingWindow.window = nil
            }
        }
        window = created
        NSApp.activate()
        created.makeKeyAndOrderFront(nil)
        return created
    }
}
