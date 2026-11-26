package studio.ergon.smerp

import android.app.Application
import go.Seq
import mobile.Mobile
import java.util.TimeZone
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors

class SmerpApplication : Application() {
    val worker = Executors.newSingleThreadExecutor()
    val launch: CompletableFuture<String> by lazy {
        CompletableFuture.supplyAsync({
            Seq.setContext(this)
            val zone = TimeZone.getDefault()
            Mobile.start(filesDir.absolutePath, zone.id, zone.getOffset(System.currentTimeMillis()) / 1000L)
        }, worker)
    }
}
