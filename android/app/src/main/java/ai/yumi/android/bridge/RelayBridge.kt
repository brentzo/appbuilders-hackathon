package ai.yumi.android.bridge

import ai.yumi.android.bridge.BridgeCrypto.Companion.b64
import ai.yumi.android.bridge.BridgeCrypto.Companion.unb64
import ai.yumi.android.errors.ErrorKind
import ai.yumi.android.protocol.ConnectionState
import ai.yumi.android.service.BridgeConnection
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import yumi.protocol.AckFrame
import yumi.protocol.AuthenticateFrame
import yumi.protocol.BridgeFrame
import yumi.protocol.ChallengeFrame
import yumi.protocol.CommandExpiredErrorKind
import yumi.protocol.CommandExpiredPayload
import yumi.protocol.DevicePlatform
import yumi.protocol.EVENT_EXPIRY_SECONDS
import yumi.protocol.EnvelopeFrame
import yumi.protocol.EnvelopeType
import yumi.protocol.ExpiredFrame
import yumi.protocol.NotPairedFrame
import yumi.protocol.PROTOCOL_VERSION
import yumi.protocol.PairAcceptFrame
import yumi.protocol.PairCancelFrame
import yumi.protocol.PairExpiredFrame
import yumi.protocol.PairRequest
import yumi.protocol.PairRequestFrame
import yumi.protocol.PairingOffer
import yumi.protocol.Payload
import yumi.protocol.PingPayload
import yumi.protocol.PingResultPayload
import yumi.protocol.RESULT_EXPIRY_SECONDS
import yumi.protocol.COMMAND_EXPIRY_SECONDS
import yumi.protocol.ReadyFrame
import yumi.protocol.RefusedFrame
import yumi.protocol.RefusedReason
import yumi.protocol.TargetNeedsUpdateFrame
import yumi.protocol.TargetOfflineFrame
import yumi.protocol.UNSUPPORTED_VERSION_RETRY_SECONDS
import yumi.protocol.UnpairFrame

/** Where the phone stands with pairing (SPEC-08 "Pair the phone with the Mac"). */
sealed interface PairingState {
    data object Idle : PairingState
    data class Waiting(val macName: String) : PairingState
    data class Paired(val macName: String) : PairingState
    data class Failed(val kind: ErrorKind) : PairingState
}

/** A message from the paired Mac. [payload] is null when it is not a payload kind this app knows. */
data class Incoming(val id: String, val type: EnvelopeType, val payload: Payload?, val replyTo: String?)

/** The relay could not deliver [messageId]; [kind] is the SPEC-11 row (protocol/docs/pairing.md, notice table). */
data class MessageFailure(val messageId: String, val kind: ErrorKind)

/** The phone's bridge client: what the rest of the app uses. */
interface Bridge : BridgeConnection {
    val deviceId: String
    val pairing: StateFlow<PairingState>

    /** The paired Mac's name, or null when not paired. */
    val pairedMac: StateFlow<String?>
    val incoming: SharedFlow<Incoming>
    val failures: SharedFlow<MessageFailure>

    /** Ids the relay acknowledged: a command reached the Mac. */
    val acks: SharedFlow<String>

    /** Starts pairing with the text of a scanned QR code. Fails with a SPEC-11 kind in [pairing]. */
    fun pair(offerText: String)

    /** The user left the pairing screen. */
    fun leavePairing()
    fun unpair()

    /** Seals and sends [payload]; returns its message id, or null when no Mac is paired. */
    fun send(type: EnvelopeType, payload: Payload, replyTo: String? = null): String?
}

/**
 * The bridge client inside the foreground service (OBJ-23), following protocol/docs/pairing.md:
 * relay authentication, pairing, sealed and signed envelopes, at-most-once handling, expiry, unpairing,
 * and reconnecting with backoff. Every state change runs on one thread, in order.
 */
class RelayBridge(
    private val crypto: BridgeCrypto,
    private val keys: () -> DeviceKeys,
    private val store: BridgeStore,
    private val deviceName: String,
    /** Allows ws:// to this machine, for the local relay stand-in in debug builds only. */
    private val allowLoopback: Boolean,
    private val log: (String) -> Unit,
    private val http: OkHttpClient = OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).build(),
    private val now: () -> Instant = { Instant.now() },
    private val reconnectBaseMs: Long = 500,
) : Bridge {
    private val thread = Executors.newSingleThreadExecutor { Thread(it, "YumiBridge").apply { isDaemon = true } }
        .asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + thread)
    private val json = Json { explicitNulls = false; ignoreUnknownKeys = true }
    private val frameSerializer = serializer<BridgeFrame>()
    private val payloadSerializer = serializer<Payload>()

    private var saved = store.load()
    private val me by lazy { keys() }
    override val deviceId: String get() = me.deviceId

    private val _state = MutableStateFlow(if (saved.peer == null) ConnectionState.NotPaired else ConnectionState.Offline)
    override val state: StateFlow<ConnectionState> = _state.asStateFlow()
    private val _pairing = MutableStateFlow<PairingState>(PairingState.Idle)
    override val pairing = _pairing.asStateFlow()
    private val _pairedMac = MutableStateFlow(saved.peer?.name)
    override val pairedMac = _pairedMac.asStateFlow()
    private val _incoming = MutableSharedFlow<Incoming>(extraBufferCapacity = 64)
    override val incoming = _incoming.asSharedFlow()
    private val _failures = MutableSharedFlow<MessageFailure>(extraBufferCapacity = 64)
    override val failures = _failures.asSharedFlow()
    private val _acks = MutableSharedFlow<String>(extraBufferCapacity = 64)
    override val acks = _acks.asSharedFlow()

    private var running = false
    private var socket: WebSocket? = null
    private var socketUrl: String? = null
    private var ready = false
    private var attempt = 0
    private var reconnectJob: Job? = null
    private var versionRefused = false

    /** The pairing in progress: the scanned offer, and whether its request still has to be sent. */
    private class PendingPairing(val offer: PairingOffer, val secret: ByteArray, var requestSent: Boolean, var timer: Job? = null)
    private var pending: PendingPairing? = null

    /** Macs whose pairing the phone cancelled or gave up on: a late pairAccept from them gets an unpair. */
    private val refusedAccepts = mutableSetOf<String>()

    override fun start(scope: CoroutineScope) {
        this.scope.launch {
            running = true
            connectIfNeeded()
        }
    }

    override fun stop() {
        scope.launch {
            running = false
            reconnectJob?.cancel()
            closeSocket()
            _state.value = if (saved.peer == null) ConnectionState.NotPaired else ConnectionState.Offline
        }
    }

    /** Android switched networks (for example Wi-Fi to mobile data): reconnect at once on the new one. */
    fun networkChanged() {
        scope.launch {
            if (!running || versionRefused) return@launch
            log("Network changed, reconnecting")
            closeSocket()
            attempt = 0
            connectIfNeeded()
        }
    }

    fun close() {
        scope.cancel()
        thread.close()
    }

    // region Pairing

    override fun pair(offerText: String) {
        scope.launch {
            val offer = runCatching { json.decodeFromString(PairingOffer.serializer(), offerText.trim()) }.getOrNull()
            val secret = offer?.let { unb64(it.pairingSecret) }
            val expires = offer?.let { runCatching { Instant.parse(it.expiresAt) }.getOrNull() }
            when {
                offer == null || secret?.size != 32 || expires == null || offer.platform != DevicePlatform.Mac ||
                    unb64(offer.signingPublicKey)?.size != 32 || unb64(offer.kxPublicKey)?.size != 32 ||
                    !urlAllowed(offer.bridgeUrl) -> return@launch failPairing(ErrorKind.NotAPairingCode, "Scanned code is not a pairing offer")
                offer.protocolVersion != PROTOCOL_VERSION ->
                    return@launch failPairing(ErrorKind.PairingVersionsDiffer, "Offer is protocol ${offer.protocolVersion}")
                !now().isBefore(expires) ->
                    // Nothing is sent to the Mac (SPEC-08 "Pairing code expired").
                    return@launch failPairing(ErrorKind.PairingCodeExpired, "Offer expired at ${offer.expiresAt}")
            }
            offer!!
            if (crypto.deviceIdFor(unb64(offer.signingPublicKey)!!) != offer.deviceId) {
                return@launch failPairing(ErrorKind.NotAPairingCode, "Offer device id does not match its key")
            }
            pending?.timer?.cancel()
            refusedAccepts.remove(offer.deviceId)
            val p = PendingPairing(offer, secret!!, requestSent = false)
            pending = p
            _pairing.value = PairingState.Waiting(offer.deviceName)
            log("Pairing with ${offer.deviceId}")
            // Give up only after 60 seconds without a verdict; while connected the relay always answers in 30.
            p.timer = scope.launch {
                delay(GIVE_UP_MS)
                if (pending === p) giveUpPairing(p)
            }
            if (ready && socketUrl == offer.bridgeUrl) sendPairRequest(p) else {
                closeSocket()
                attempt = 0
                connectIfNeeded()
            }
        }
    }

    override fun leavePairing() {
        scope.launch {
            val p = pending
            if (p != null) {
                log("Pairing cancelled by leaving the screen")
                p.timer?.cancel()
                pending = null
                refusedAccepts += p.offer.deviceId
                if (!send(PairCancelFrame(me.deviceId, p.offer.deviceId))) {
                    remember(AbandonedPairing(p.offer.deviceId, p.offer.bridgeUrl, wasPaired = saved.peer?.deviceId == p.offer.deviceId))
                }
                connectIfNeeded()
            }
            _pairing.value = PairingState.Idle
        }
    }

    private fun failPairing(kind: ErrorKind, detail: String) {
        log("Pairing failed ($kind): $detail")
        _pairing.value = PairingState.Failed(kind)
    }

    private fun giveUpPairing(p: PendingPairing) {
        pending = null
        refusedAccepts += p.offer.deviceId
        remember(AbandonedPairing(p.offer.deviceId, p.offer.bridgeUrl, wasPaired = saved.peer?.deviceId == p.offer.deviceId))
        failPairing(ErrorKind.MacDidntAnswerPairing, "No verdict within 60 seconds")
        if (ready) sendAbandoned()
        connectIfNeeded()
    }

    private fun remember(a: AbandonedPairing) {
        update { it.copy(abandoned = it.abandoned.filterNot { x -> x.macId == a.macId } + a) }
    }

    private fun sendAbandoned() {
        for (a in saved.abandoned) {
            if (a.bridgeUrl != socketUrl) continue
            send(PairCancelFrame(me.deviceId, a.macId))
            if (!a.wasPaired) queueUnpair(a.macId)
        }
        update { it.copy(abandoned = it.abandoned.filterNot { a -> a.bridgeUrl == socketUrl }) }
    }

    private fun sendPairRequest(p: PendingPairing) {
        val request = PairRequest(deviceName, DevicePlatform.Android, b64(me.signingPublicKey), b64(me.kxPublicKey))
        val sealed = crypto.sealPairRequest(
            json.encodeToString(PairRequest.serializer(), request), me.deviceId, p.offer.deviceId, p.secret,
        )
        if (send(PairRequestFrame(me.deviceId, p.offer.deviceId, sealed))) p.requestSent = true
    }

    private fun onPairAccept(frame: PairAcceptFrame) {
        val p = pending
        if (frame.to != me.deviceId) return
        if (p == null || p.offer.deviceId != frame.from) {
            if (saved.peer?.deviceId == frame.from) return // A held verdict delivered again.
            if (frame.from in refusedAccepts || saved.abandoned.any { it.macId == frame.from } || p == null) {
                // A pairing the phone cancelled or gave up on: undo it at the relay, never store this Mac.
                log("Answering a late pairAccept with unpair")
                queueUnpair(frame.from)
            }
            return
        }
        val signature = unb64(frame.accept.signature)
        val macKey = unb64(p.offer.signingPublicKey)!!
        if (signature == null || !crypto.verifyPairAccept(signature, frame.from, macKey, me)) {
            log("Dropped a pairAccept with a bad signature")
            return
        }
        p.timer?.cancel()
        pending = null
        val peer = SavedPeer(
            deviceId = p.offer.deviceId,
            name = p.offer.deviceName,
            signingPublicKey = p.offer.signingPublicKey,
            kxPublicKey = p.offer.kxPublicKey,
            pairedAt = timestamp(now()),
            bridgeUrl = p.offer.bridgeUrl,
        )
        // Pairing again clears old receipts, outbox, and pending unpairs for this Mac.
        update {
            it.copy(
                peer = peer,
                relayUrl = peer.bridgeUrl,
                outbox = emptyList(),
                processed = emptyList(),
                receivedUnpairs = emptyList(),
                pendingUnpairs = it.pendingUnpairs.filterNot { u -> u.to == peer.deviceId },
                abandoned = it.abandoned.filterNot { a -> a.macId == peer.deviceId },
            )
        }
        _pairedMac.value = peer.name
        _pairing.value = PairingState.Paired(peer.name)
        _state.value = ConnectionState.Connected
        log("Paired with ${peer.deviceId}")
    }

    private fun onPairExpired(frame: PairExpiredFrame) {
        val p = pending ?: return
        if (frame.device != p.offer.deviceId || !p.requestSent) return
        p.timer?.cancel()
        pending = null
        refusedAccepts += p.offer.deviceId
        failPairing(ErrorKind.MacDidntAnswerPairing, "Relay sent pairExpired")
        connectIfNeeded()
    }

    // endregion

    // region Unpairing

    override fun unpair() {
        scope.launch {
            val peer = saved.peer ?: return@launch
            queueUnpair(peer.deviceId)
            forgetPeer()
            log("Unpaired from settings")
        }
    }

    private fun queueUnpair(to: String) {
        if (saved.pendingUnpairs.any { it.to == to }) {
            saved.pendingUnpairs.filter { it.to == to }.forEach { socket?.send(it.frame) }
            return
        }
        val id = UUID.randomUUID().toString()
        val at = timestamp(now())
        val frame = UnpairFrame(id, me.deviceId, to, at, b64(crypto.signUnpair(id, me.deviceId, to, at, me)))
        val text = json.encodeToString(frameSerializer, frame)
        update { it.copy(pendingUnpairs = it.pendingUnpairs + PendingUnpair(id, to, text)) }
        if (ready) socket?.send(text)
    }

    private fun onUnpair(frame: UnpairFrame) {
        if (frame.id in saved.receivedUnpairs) {
            send(AckFrame(frame.id))
            return
        }
        val peer = saved.peer
        val signature = unb64(frame.signature)
        val at = runCatching { Instant.parse(frame.at) }.getOrNull()
        if (peer == null || frame.from != peer.deviceId || frame.to != me.deviceId || signature == null || at == null ||
            !at.isAfter(Instant.parse(peer.pairedAt)) ||
            !crypto.verifyUnpair(signature, frame.id, frame.from, frame.to, frame.at, unb64(peer.signingPublicKey)!!)
        ) {
            log("Dropped an unpair that did not verify")
            return
        }
        update { it.copy(receivedUnpairs = it.receivedUnpairs + frame.id) }
        send(AckFrame(frame.id))
        forgetPeer()
        log("Unpaired by the Mac")
    }

    private fun forgetPeer() {
        update { it.copy(peer = null, outbox = emptyList(), processed = emptyList()) }
        _pairedMac.value = null
        _pairing.value = PairingState.Idle
        connectIfNeeded()
    }

    // endregion

    // region Messages

    override fun send(type: EnvelopeType, payload: Payload, replyTo: String?): String? {
        val peer = saved.peer ?: return null
        val id = UUID.randomUUID().toString()
        scope.launch {
            if (saved.peer?.deviceId != peer.deviceId) return@launch
            val text = sealFrame(peer, id, type, payload, replyTo)
            val expiresAt = json.decodeFromString(frameSerializer, text).let { (it as EnvelopeFrame).envelope.expiresAt }
            update { it.copy(outbox = it.outbox + OutboxItem(id, text, expiresAt, type == EnvelopeType.Command)) }
            if (ready) socket?.send(text)
        }
        return id
    }

    private fun sealFrame(peer: SavedPeer, id: String, type: EnvelopeType, payload: Payload, replyTo: String?): String {
        val seconds = when (type) {
            EnvelopeType.Command -> COMMAND_EXPIRY_SECONDS
            EnvelopeType.Result -> RESULT_EXPIRY_SECONDS
            EnvelopeType.Event -> EVENT_EXPIRY_SECONDS
        }
        val body = buildJsonObject {
            if (replyTo != null) put("replyTo", JsonPrimitive(replyTo))
            put("payload", json.encodeToJsonElement(payloadSerializer, payload))
        }
        val envelope = crypto.sealEnvelope(
            me, peer.keys(), type, timestamp(now().plusSeconds(seconds)), json.encodeToString(JsonObject.serializer(), body), id,
        )
        return json.encodeToString(frameSerializer, EnvelopeFrame(envelope))
    }

    private fun onEnvelope(frame: EnvelopeFrame) {
        val envelope = frame.envelope
        val peer = saved.peer
        if (peer == null || envelope.from != peer.deviceId) {
            // SPEC-08 r5: never act on a device this phone is not paired with.
            log("Dropped an envelope from an unpaired device")
            return
        }
        val seen = saved.processed.firstOrNull { it.id == envelope.id }
        when (val opened = crypto.openEnvelope(envelope, me, peer.keys(), now())) {
            is OpenResult.Failed -> log("Dropped an envelope: ${opened.reason}")
            is OpenResult.Expired -> {
                // Never run an expired command (SPEC-08 r6). If it already ran, resend the stored result.
                when {
                    seen?.resultFrame != null -> socket?.send(seen.resultFrame)
                    seen == null && envelope.type == EnvelopeType.Command -> {
                        log("Command ${envelope.id} arrived expired, not run")
                        reply(peer, envelope.id, CommandExpiredPayload(envelope.id, CommandExpiredErrorKind.CommandExpired))
                    }
                }
                send(AckFrame(envelope.id))
            }
            is OpenResult.Opened -> {
                if (seen != null) {
                    // At most once (SPEC-08 r8): resend the stored result instead of running it again.
                    seen.resultFrame?.let { socket?.send(it) }
                    send(AckFrame(envelope.id))
                    return
                }
                val body = runCatching { json.parseToJsonElement(opened.plaintext).jsonObject }.getOrNull()
                if (body == null || "payload" !in body) {
                    log("Dropped an envelope with an invalid payload")
                    return
                }
                val replyTo = runCatching { body["replyTo"]?.jsonPrimitive?.content }.getOrNull()
                val payload = try {
                    json.decodeFromJsonElement(payloadSerializer, body.getValue("payload"))
                } catch (e: SerializationException) {
                    null
                } catch (e: IllegalArgumentException) {
                    null
                }
                if (payload == null) log("Message ${envelope.id} has a payload kind this app does not know")
                if (envelope.type == EnvelopeType.Command) {
                    runCommand(peer, envelope.id, payload)
                } else {
                    markProcessed(envelope.id, null)
                    _incoming.tryEmit(Incoming(envelope.id, envelope.type, payload, replyTo))
                }
                send(AckFrame(envelope.id))
            }
        }
    }

    /** The phone answers only ping for now; tools and approvals on the phone were cut for the demo. */
    private fun runCommand(peer: SavedPeer, id: String, payload: Payload?) {
        when (payload) {
            PingPayload -> {
                log("Ping from the Mac")
                reply(peer, id, PingResultPayload)
            }
            else -> {
                log("Command $id is not one the phone runs")
                markProcessed(id, null)
            }
        }
    }

    private fun reply(peer: SavedPeer, commandId: String, payload: Payload) {
        val text = sealFrame(peer, UUID.randomUUID().toString(), EnvelopeType.Result, payload, commandId)
        // Record the result before sending it, so a repeat gets the same result even after a crash.
        markProcessed(commandId, text)
        socket?.send(text)
    }

    private fun markProcessed(id: String, resultFrame: String?) {
        val cutoff = now().toEpochMilli() - PROCESSED_KEEP_MS
        update { s ->
            s.copy(processed = s.processed.filter { it.at > cutoff && it.id != id } + Processed(id, resultFrame, now().toEpochMilli()))
        }
    }

    private fun onNotice(messageId: String, kind: ErrorKind?) {
        val unpair = saved.pendingUnpairs.firstOrNull { it.id == messageId }
        if (unpair != null) {
            if (kind == null) {
                update { it.copy(pendingUnpairs = it.pendingUnpairs - unpair) }
                connectIfNeeded()
            }
            return
        }
        val item = saved.outbox.firstOrNull { it.id == messageId }
        update { it.copy(outbox = it.outbox.filterNot { o -> o.id == messageId }) }
        if (kind == null) {
            _acks.tryEmit(messageId)
        } else {
            log("Relay could not deliver $messageId: $kind")
            if (item != null) _failures.tryEmit(MessageFailure(messageId, kind))
        }
    }

    // endregion

    // region Connection

    private fun desiredUrl(): String? = pending?.offer?.bridgeUrl ?: saved.peer?.bridgeUrl
        ?: saved.abandoned.firstOrNull()?.bridgeUrl
        ?: saved.relayUrl?.takeIf { saved.pendingUnpairs.isNotEmpty() }

    private fun connectIfNeeded() {
        if (!running) return
        val url = desiredUrl()
        if (url == null) {
            closeSocket()
            _state.value = ConnectionState.NotPaired
            return
        }
        if (socket != null && socketUrl == url) return
        closeSocket()
        reconnectJob?.cancel()
        log("Connecting to the relay")
        socketUrl = url
        val listener = Listener()
        socket = http.newWebSocket(Request.Builder().url(url).build(), listener)
    }

    private fun closeSocket() {
        socket?.cancel()
        socket = null
        socketUrl = null
        ready = false
    }

    private fun onDisconnected(from: WebSocket) {
        if (from !== socket) return
        socket = null
        socketUrl = null
        ready = false
        if (!running) return
        if (versionRefused) {
            _state.value = ConnectionState.Offline
            scheduleReconnect(UNSUPPORTED_VERSION_RETRY_SECONDS * 1000)
            return
        }
        val delayMs = minOf(30_000L, reconnectBaseMs shl minOf(attempt, 6))
        attempt++
        if (saved.peer != null) _state.value = if (attempt > OFFLINE_AFTER) ConnectionState.Offline else ConnectionState.Reconnecting
        scheduleReconnect(delayMs)
    }

    private fun scheduleReconnect(delayMs: Long) {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            connectIfNeeded()
        }
    }

    private fun onFrame(from: WebSocket, text: String) {
        if (from !== socket) return
        val frame = try {
            json.decodeFromString(frameSerializer, text)
        } catch (e: SerializationException) {
            log("Dropped a frame that is not a BridgeFrame")
            return
        } catch (e: IllegalArgumentException) {
            log("Dropped a frame that is not a BridgeFrame")
            return
        }
        when (frame) {
            is ChallengeFrame -> {
                val nonce = unb64(frame.nonce) ?: return
                send(AuthenticateFrame(me.deviceId, b64(me.signingPublicKey), PROTOCOL_VERSION, b64(crypto.relayAuthSignature(nonce, me))))
            }
            ReadyFrame -> onReady()
            is RefusedFrame -> {
                if (frame.reason == RefusedReason.UnsupportedVersion) {
                    // Keep every key and pairing; try again every 5 minutes (pairing.md, "Another protocol version").
                    versionRefused = true
                    log("Relay refused protocol $PROTOCOL_VERSION; it speaks ${frame.protocolVersion}")
                } else {
                    log("Relay refused the connection: ${frame.reason}")
                }
            }
            is PairAcceptFrame -> onPairAccept(frame)
            is PairExpiredFrame -> onPairExpired(frame)
            is EnvelopeFrame -> onEnvelope(frame)
            is UnpairFrame -> onUnpair(frame)
            is AckFrame -> onNotice(frame.messageId, null)
            is TargetOfflineFrame -> onNotice(frame.messageId, ErrorKind.OtherDeviceOffline)
            // Reads as offline until OBJ-42 adds its own kind (pairing.md).
            is TargetNeedsUpdateFrame -> onNotice(frame.messageId, ErrorKind.OtherDeviceOffline)
            is ExpiredFrame -> onNotice(frame.messageId, ErrorKind.CommandExpired)
            is NotPairedFrame -> onNotice(frame.messageId, ErrorKind.UnpairedDevice)
            else -> log("Ignored a ${frame::class.simpleName} frame")
        }
    }

    private fun onReady() {
        ready = true
        attempt = 0
        versionRefused = false
        log("Connected to the relay")
        if (saved.peer != null) _state.value = ConnectionState.Connected
        sendAbandoned()
        saved.pendingUnpairs.forEach { socket?.send(it.frame) }
        pending?.let { if (!it.requestSent) sendPairRequest(it) }
        // Resend what the relay has not acknowledged, with the same ids, unless it expired.
        val (live, stale) = saved.outbox.partition { now().isBefore(Instant.parse(it.expiresAt)) }
        stale.filter { it.command }.forEach { _failures.tryEmit(MessageFailure(it.id, ErrorKind.CommandExpired)) }
        if (stale.isNotEmpty()) update { it.copy(outbox = live) }
        live.forEach { socket?.send(it.frame) }
    }

    private fun send(frame: BridgeFrame): Boolean = socket?.takeIf { ready || frame is AuthenticateFrame }
        ?.send(json.encodeToString(frameSerializer, frame)) ?: false

    private inner class Listener : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            scope.launch { onFrame(webSocket, text) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
            scope.launch { onDisconnected(webSocket) }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            scope.launch { onDisconnected(webSocket) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            // The transport detail goes to the log only; the user sees the connection state.
            scope.launch {
                if (webSocket === socket) log("Relay connection failed: ${t.javaClass.simpleName}")
                onDisconnected(webSocket)
            }
        }
    }

    // endregion

    private fun urlAllowed(url: String): Boolean =
        url.startsWith("wss://") || (allowLoopback && LOOPBACK.matches(url))

    private fun update(change: (BridgeSaved) -> BridgeSaved) {
        saved = change(saved)
        store.save(saved)
    }

    private fun SavedPeer.keys() = PeerKeys(deviceId, unb64(signingPublicKey)!!, unb64(kxPublicKey)!!)

    companion object {
        private const val GIVE_UP_MS = 60_000L
        private const val PROCESSED_KEEP_MS = 10 * 60_000L

        /** Failed attempts before the state shows offline instead of reconnecting. */
        private const val OFFLINE_AFTER = 5
        private val LOOPBACK = Regex("""^ws://(localhost|127\.0\.0\.1)(:\d+)?/?$""")

        fun timestamp(instant: Instant): String = instant.truncatedTo(ChronoUnit.MILLIS).toString()
    }
}
