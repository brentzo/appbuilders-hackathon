import Foundation
import Security

/// Yumi's secrets in the macOS Keychain (OBJ-27.4), for example the bridge device key.
///
/// Each secret is a generic password item under one service name, so Yumi's items are easy to find
/// and remove in Keychain Access. Values are only ever handled as bytes in memory: never written to
/// a file, never logged.
nonisolated struct SecretStore: Sendable {
    enum Failure: Error, Equatable {
        case keychain(OSStatus)
    }

    /// Yumi's bundle identifier plus ".secrets", so each person's build keeps its own items.
    let service: String

    init(service: String = (Bundle.main.bundleIdentifier ?? "ph.appbuilders.yumi") + ".secrets") {
        self.service = service
    }

    func store(_ value: Data, for key: String) throws {
        let query = baseQuery(key)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw Failure.keychain(update) }
        var item = query
        item[kSecValueData as String] = value
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { throw Failure.keychain(added) }
    }

    /// The stored value, or nil when there is none.
    func load(_ key: String) throws -> Data? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
        return result as? Data
    }

    func delete(_ key: String) throws {
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.keychain(status) }
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}
