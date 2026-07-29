# PR 3 validation

Validation was executed by the one-shot implementation workflow.

| Check                                          | Exit code |
| ---------------------------------------------- | --------: |
| `pnpm run typecheck`                           |         2 |
| `pnpm --filter @workspace/api-server run test` |         0 |

Normal pull-request CI remains authoritative after this branch is rebased in programme order.
