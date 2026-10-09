package ai.yumi.android.bridge

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The phone's device keys (OBJ-23.1), stored encrypted by an AES key that never leaves the Android Keystore.
 * Only the two 32-byte libsodium seeds are stored, as AES-GCM ciphertext in the app's private preferences.
 * Nothing here is ever logged.
 */
class DeviceKeyStore(context: Context, private val crypto: BridgeCrypto) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Volatile private var cached: DeviceKeys? = null

    @Synchronized
    fun keys(): DeviceKeys {
        cached?.let { return it }
        val stored = prefs.getString(KEY_SEEDS, null)?.let { decrypt(it) }
        val seeds = stored ?: crypto.randomBytes(64).also {
            check(prefs.edit().putString(KEY_SEEDS, encrypt(it)).commit()) { "Could not save the device keys" }
        }
        return crypto.keysFromSeeds(seeds.copyOfRange(0, 32), seeds.copyOfRange(32, 64)).also {
            seeds.fill(0)
            cached = it
        }
    }

    private fun wrappingKey(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, wrappingKey()) }
        return BridgeCrypto.b64(cipher.iv) + ":" + BridgeCrypto.b64(cipher.doFinal(plain))
    }

    private fun decrypt(stored: String): ByteArray? = runCatching {
        val (iv, body) = stored.split(':').map { BridgeCrypto.unb64(it)!! }
        Cipher.getInstance(TRANSFORMATION)
            .apply { init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, iv)) }
            .doFinal(body)
    }.getOrNull()

    private companion object {
        const val PREFS = "yumi_device_keys"
        const val KEY_SEEDS = "seeds"
        const val ALIAS = "yumi_device_keys_wrap"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
