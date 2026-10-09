import OSLog

/// Where settings go when they change, so the harness can use the ones it needs
/// (for example the visible cursor cap and demo mode for routing and tiling).
///
/// The real sink sends them over the harness link (OBJ-14.5) with the generated protocol types
/// from `protocol/` (OBJ-01). Neither exists yet, so `PendingHarnessSettingsSink` stands in.
/// Swapping it is a one-line change in `AppModel`.
protocol HarnessSettingsSink {
    func settingsDidChange(_ settings: YumiSettings)
}

/// Stand-in until the harness link exists: it only logs that nothing was sent.
struct PendingHarnessSettingsSink: HarnessSettingsSink {
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "settings")

    func settingsDidChange(_ settings: YumiSettings) {
        log.notice("Stand-in: settings not sent to the harness, the harness link is not built yet (OBJ-14.5)")
    }
}
