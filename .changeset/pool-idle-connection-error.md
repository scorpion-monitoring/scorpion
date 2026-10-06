---
'scorpion': patch
---

The server and the worker no longer exit when PostgreSQL ends an idle connection (a database restart, a failover, `pg_terminate_backend`). The pool drops the connection, logs a warning ("an idle database connection was lost") with the SQLSTATE, and opens a new one when it is next needed. On shutdown the process now waits until every database connection is closed.
