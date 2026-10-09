package com.cyvra.sanitization

import android.app.Activity
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Three lines of text. Nothing else.
 *
 * PROOF OF CONCEPT: there are deliberately **no buttons** (so the wipe cannot be
 * triggered by a mis-tap), **no network calls** (this module declares no INTERNET
 * permission at all), and **no storage access**. The activity cannot start a purge;
 * only the exported broadcast receiver can, and only from the operator's shell.
 */
class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START
            setPadding(dp(24), dp(48), dp(24), dp(24))
        }

        root.addView(line(TITLE, sp = 20f, bold = true))
        root.addView(line(WARNING, sp = 15f))
        root.addView(line(STATUS, sp = 15f))

        setContentView(root)
    }

    private fun line(text: String, sp: Float, bold: Boolean = false): TextView =
        TextView(this).apply {
            this.text = text
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
            if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(12), 0, dp(12))
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()

    companion object {
        private const val TITLE = "CYVRA Sanitization Agent — PROOF OF CONCEPT"

        private const val WARNING =
            "This APK exists only to enable dpm set-device-owner for the wipe proof. " +
                "It is erased by the wipe. Do not install on production devices."

        private const val STATUS = "Status: awaiting device-owner enrollment via adb"
    }
}
