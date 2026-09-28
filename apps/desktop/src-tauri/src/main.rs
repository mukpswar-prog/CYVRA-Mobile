// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Packaging gate / first-run preflight: resolve the bundled Host runtime,
  // boot it and perform one protocol round-trip without opening a window.
  // Exit code 0 means the installed layout is complete and the Host answered.
  if std::env::args().any(|arg| arg == "--selftest") {
    match app_lib::host_selftest() {
      Ok(report) => {
        println!("{report}");
        std::process::exit(0);
      }
      Err(error) => {
        eprintln!("SELFTEST_FAILED: {error}");
        std::process::exit(1);
      }
    }
  }

  app_lib::run();
}
