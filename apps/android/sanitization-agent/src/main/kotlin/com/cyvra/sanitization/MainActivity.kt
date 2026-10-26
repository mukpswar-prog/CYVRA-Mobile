package com.cyvra.sanitization

import android.app.Activity
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Clean status display for the CYVRA Sanitization Agent.
 *
 * Adheres to CYVRA-POL-AGENT-01:
 * - No buttons (wipe is triggered exclusively via authorized ADB broadcast)
 * - No network permissions
 * - No storage access
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
        private const val TITLE = "CYVRA Sanitization Agent"

        private const val WARNING =
            "CYVRA Mobile Device Owner Sanitization Component. " +
                "Erases user data upon authorized command."

        private const val STATUS = "Status: active"
    }
}
