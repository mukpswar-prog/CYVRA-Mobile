# Support logs

## Where they are
`<CYVRA home>\logs\host-<UTC stamp>.log` — for example
`host-20260929T141530Z.log`. `<CYVRA home>` is the same folder the workstation
writes its reports into. The `logs` folder is created on demand, one file is
written per launch of the inspection engine, and only the newest 10 are kept.

## How to collect
Send the newest `host-*.log`. Nothing has to be switched on: the file exists
from the moment the engine starts, and the UTC stamp in its name is the launch
time, so it can be matched to when the operator reported the problem.

## What is in it
The Java inspection engine's own diagnostic stream — JVM warnings, stack
traces, ADB errors — appended as it happens, up to the point where the engine
stopped.

## Privacy
Protocol stderr only. The request/response JSON pipe between the desktop and
the engine is never written to disk, and the log carries no customer content:
no application inventory, no device report, no exported artifact, and never a
phone's IMEI. Treat it as engineering detail, not as case data.
