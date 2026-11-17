function bindPowerEvents(powerMonitor, backend, feed) {
  let suspended = false;
  const suspend = () => {
    suspended = feed.running;
    if (suspended) {
      feed.stop();
      feed.state("suspended");
    }
  };
  const resume = () => {
    // Re-open the connection and obtain an authoritative snapshot. Do not resume
    // deliberately paused tasks or relaunch a failed kernel behind the user's back.
    if (backend.state === "ready" && (suspended || feed.running)) feed.start();
    suspended = false;
  };
  powerMonitor.on("suspend", suspend);
  powerMonitor.on("resume", resume);
  return () => {
    powerMonitor.removeListener("suspend", suspend);
    powerMonitor.removeListener("resume", resume);
  };
}
module.exports = { bindPowerEvents };
