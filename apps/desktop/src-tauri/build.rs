use std::path::PathBuf;

fn main() {
    // `bundle.resources` points at the staged payload (`.resources/`), which
    // only exists once `pnpm stage:resources` has run. tauri-build fails
    // outright on a missing path, so `cargo test` or `cargo build` on a fresh
    // checkout - or in CI, where packaging runs *after* the test steps - died
    // with "failed to run custom build command" before compiling a single
    // line of application code.
    //
    // Creating the directory keeps compilation and tests working on an
    // un-staged tree. It cannot produce an incomplete installer:
    // `beforeBuildCommand` populates `.resources/` before bundling starts and
    // aborts the build if it cannot, and the CI layout gate re-verifies the
    // packaged payload by running `--selftest` against it.
    let staged = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".resources");
    if !staged.exists() {
        let _ = std::fs::create_dir_all(&staged);
    }

    tauri_build::build()
}
