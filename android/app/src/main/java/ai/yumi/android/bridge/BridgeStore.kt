package ai.yumi.android.bridge

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The paired Mac: public keys only. */
@Serializable
data class SavedPeer(
    val deviceId: String,
    val name: String,
    val signingPublicKey: String,
    val kxPublicKey: String,
    val pairedAt: String,
    val bridgeUrl: String,
)

/** A message the relay has not acknowledged yet, resent with the same id after a reconnect until it expires. */
@Serializable
data class OutboxItem(val id: String, val frame: String, val expiresAt: String, val command: Boolean)

/** A message id this phone already handled, with the result frame it sent, if any (SPEC-08 r8). */
@Serializable
data class Processed(val id: String, val resultFrame: String?, val at: Long)

/** A signed unpair, retried as the exact same frame until the relay acknowledges its id. */
@Serializable
data class PendingUnpair(val id: String, val to: String, val frame: String)

/** A pairing the phone gave up on: on the next connection it sends pairCancel and, unless already paired, unpair. */
@Serializable
data class AbandonedPairing(val macId: String, val bridgeUrl: String, val wasPaired: Boolean)

@Serializable
data class BridgeSaved(
    val peer: SavedPeer? = null,
    val outbox: List<OutboxItem> = emptyList(),
    val processed: List<Processed> = emptyList(),
    val pendingUnpairs: List<PendingUnpair> = emptyList(),
    val receivedUnpairs: List<String> = emptyList(),
    val abandoned: List<AbandonedPairing> = emptyList(),
    /** The relay of the last pairing, kept after unpairing so pending unpairs still reach it. */
    val relayUrl: String? = null,
)

/** Where the bridge keeps what must survive a restart. Writes are synchronous, so a crash never loses a receipt. */
interface BridgeStore {
    fun load(): BridgeSaved
    fun save(saved: BridgeSaved)
}

class MemoryBridgeStore(var saved: BridgeSaved = BridgeSaved()) : BridgeStore {
    override fun load() = saved
    override fun save(saved: BridgeSaved) { this.saved = saved }
}

class PrefsBridgeStore(context: Context) : BridgeStore {
    private val prefs = context.getSharedPreferences("yumi_bridge", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    override fun load(): BridgeSaved =
        prefs.getString(KEY, null)?.let { runCatching { json.decodeFromString(BridgeSaved.serializer(), it) }.getOrNull() }
            ?: BridgeSaved()

    override fun save(saved: BridgeSaved) {
        check(prefs.edit().putString(KEY, json.encodeToString(BridgeSaved.serializer(), saved)).commit()) {
            "Could not save the bridge state"
        }
    }

    private companion object { const val KEY = "state" }
}
