package com.rabelow.tubify;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || getBridge().getWebView() == null) {
                    finish();
                    return;
                }
                final WebView webView = getBridge().getWebView();
                webView.evaluateJavascript(
                    "(function(){ return window.__handleTubifyBack ? window.__handleTubifyBack() : 'exit'; })()",
                    value -> {
                        if (value != null && value.contains("handled")) {
                            return;
                        }
                        runOnUiThread(() -> finish());
                    }
                );
            }
        });
    }
}
