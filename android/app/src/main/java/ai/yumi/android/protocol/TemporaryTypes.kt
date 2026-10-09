package ai.yumi.android.protocol

// TEMPORARY: app-local stand-ins until the generated Kotlin types from protocol/ (OBJ-01) land.
// Keep this file minimal. When the generated types exist, replace these and delete the file.

/** Bridge connection state shown on the home screen and in the notification (SPEC-08 requirement 10). */
enum class ConnectionState {
    /** No Mac has been paired yet (OBJ-23). */
    NotPaired,
    Connected,
    Reconnecting,
    Offline,
}
