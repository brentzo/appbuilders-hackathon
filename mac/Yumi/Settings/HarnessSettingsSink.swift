import OSLog

/// Where settings go when they change, so the harness can use the ones it needs
/// (for example the visible cursor cap and demo mode for routing and tiling).
///
/// The real sink will send them over the harness link (`HarnessClient`) with generated protocol
/// types. The protocol has no method for settings yet, so `PendingHarnessSettingsSink` stands in.
/// Swapping it is a one-line change in `AppModel`.
protocol HarnessSettingsSink {
    func settingsDidChange(_ settings: YumiSettings)
}

/// Stand-in until the protocol has a settings method: it only logs that nothing was sent.
struct PendingHarnessSettingsSink: HarnessSettingsSink {
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "settings")

    func settingsDidChange(_ settings: YumiSettings) {
        log.notice("Stand-in: settings not sent to the harness, the protocol has no settings method yet")
    }
}
