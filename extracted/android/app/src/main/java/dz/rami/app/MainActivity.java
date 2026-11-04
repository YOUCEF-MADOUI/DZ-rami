package dz.rami.app;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Coquille native minimale : Capacitor charge l'export web (out/) dans sa WebView.
 *
 * Seul ajout : l'écran reste allumé pendant une partie (une manche peut durer
 * plusieurs minutes sans interaction tactile sur le téléphone).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
