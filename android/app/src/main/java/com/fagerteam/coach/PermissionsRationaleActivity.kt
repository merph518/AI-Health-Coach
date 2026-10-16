package com.fagerteam.coach

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle

/** Health Connect links here from its permission screen: what the app reads and why. */
class PermissionsRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AlertDialog.Builder(this)
            .setTitle(R.string.rationale_title)
            .setMessage(R.string.rationale_body)
            .setPositiveButton(R.string.rationale_done) { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }
}
