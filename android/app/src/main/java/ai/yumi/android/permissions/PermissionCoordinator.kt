package ai.yumi.android.permissions

import ai.yumi.android.errors.ErrorKind
import ai.yumi.android.errors.ErrorPresenter
import ai.yumi.android.errors.PresentedError
import android.Manifest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** A permission a tool asks for the first time it needs it (SPEC-10 requirement 6). */
enum class ToolPermission(
    val manifestPermission: String,
    val errorKind: ErrorKind,
    /** Fills `{permission}` in the SPEC-11 copy: "I need permission to use your location for this." */
    val plainName: String,
) {
    Location(Manifest.permission.ACCESS_COARSE_LOCATION, ErrorKind.PermissionMissingAndroid, "location"),
}

/** A pending permission request, shown by the activity. */
data class PermissionRequest(
    val permission: ToolPermission,
    val error: PresentedError,
    /** The app was in the background, so the request was posted as a notification. */
    val postedAsNotification: Boolean,
    /** The user tapped that notification, so the activity goes straight to the Android dialog. */
    val openedFromNotification: Boolean = false,
)

/** What the coordinator needs from Android. Faked in tests. */
interface PermissionEnvironment {
    fun isGranted(permission: ToolPermission): Boolean
    fun isAppInForeground(): Boolean
    fun postBackgroundRequest(permission: ToolPermission, text: String)
    fun cancelBackgroundRequest(permission: ToolPermission)
}

/**
 * Lets a tool ask for an Android permission from anywhere, including the foreground service.
 *
 * In the foreground, the activity shows the SPEC-11 copy with "Allow" and "Not now".
 * In the background, Android cannot show a permission dialog, so a notification explains why;
 * tapping it opens the app, which shows the Android dialog.
 * Requests run one at a time.
 */
class PermissionCoordinator(
    private val environment: PermissionEnvironment,
    private val presenter: ErrorPresenter,
) {
    private val mutex = Mutex()
    private val _request = MutableStateFlow<PermissionRequest?>(null)
    val request: StateFlow<PermissionRequest?> = _request.asStateFlow()
    private var answer: CompletableDeferred<Boolean>? = null

    /** Returns true once the permission is granted, false if the user said no. Callers bound the wait with a timeout. */
    suspend fun ensure(permission: ToolPermission): Boolean {
        if (environment.isGranted(permission)) return true
        return mutex.withLock {
            if (environment.isGranted(permission)) return@withLock true
            val deferred = CompletableDeferred<Boolean>()
            answer = deferred
            val inBackground = !environment.isAppInForeground()
            val error = presenter.present(permission.errorKind, permission = permission.plainName)
            if (inBackground) environment.postBackgroundRequest(permission, error.text)
            _request.value = PermissionRequest(permission, error, postedAsNotification = inBackground)
            try {
                deferred.await()
            } finally {
                answer = null
                _request.value = null
                if (inBackground) environment.cancelBackgroundRequest(permission)
            }
        }
    }

    /** The user tapped the background notification for [permission]. */
    fun onOpenedFromNotification(permission: ToolPermission) {
        _request.update { if (it?.permission == permission) it.copy(openedFromNotification = true) else it }
    }

    /** The user answered: the Android dialog's result, a return from app settings, or "Not now". */
    fun onAnswered(granted: Boolean) {
        answer?.complete(granted)
    }
}
