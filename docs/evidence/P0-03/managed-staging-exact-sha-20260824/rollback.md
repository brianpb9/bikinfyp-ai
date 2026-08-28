# Rollback readiness

Rollback was not executed because both deploys, migration, parity, and health
succeeded. The exact captured targets remain:

| Service | Prior deploy | Prior full SHA |
|---|---|---|
| staging web | `dep-d9rugpuq1p3s73ajvvpg` | `5fe53f27436d917d5232e23ef6c6e624eb00428a` |
| staging worker | `dep-d9tgs715efls73e32hug` | `78d84685de6db63724ac2715ef516917d0c4ce3c` |

Both SHAs are local commit objects and ancestors of the deployed target. The
explicit control path accepted by Render is:

```text
render deploys create <staging-service-id> --commit <prior-full-sha> --wait --confirm --output json
```

Failure sequence: enable maintenance on staging web; rollback worker and web to
their captured targets; wait for both commands; verify control-plane SHA,
health, autoDeploy, maintenance restoration, DB state, and staging allow-list
length zero. Production is never part of this path.

Migration caveat: the pre-deploy migration set is forward-only and immutable.
Rolling application code back does not down-migrate the staging schema. The
older SHAs previously ran on this datastore; nevertheless a real rollback must
verify their health rather than assume schema compatibility.
