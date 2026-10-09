package ai.yumi.android.ui.components

import ai.yumi.android.R
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.imageResource

/**
 * The Yumi mark (character/assets/logo), optically centred. The exported art sits left of centre:
 * the cat's mass centres at 45.3% across, so it moves right by 4.7% of its width.
 *
 * The images come from android/scripts/render-mark.py. [happy] has the closed, smiling eyes of the Mac's "done" pose.
 * [small] picks the copy rendered for 26 dp, because the 1024 px art drawn that small turns its outline jagged.
 */
@Composable
fun YumiMark(modifier: Modifier = Modifier, small: Boolean = false, happy: Boolean = false) {
    Image(
        ImageBitmap.imageResource(
            when {
                small -> R.drawable.yumi_mark_small
                happy -> R.drawable.yumi_mark_happy
                else -> R.drawable.yumi_mark
            },
        ),
        contentDescription = null,
        filterQuality = FilterQuality.High,
        modifier = modifier.graphicsLayer { translationX = size.width * 0.047f },
    )
}
