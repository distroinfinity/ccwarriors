---
title: API
description: The HTTP surface and the wire contracts that must not break.
---

# API

[HTTP Endpoints](http-endpoints.md) is the route catalogue: every endpoint, its auth, parameters, status codes, and cache behavior, plus which env vars gate which route groups. [Payload Schemas and Compatibility](payload-schemas-and-compatibility.md) is the contract page: the ingest payload versions, the WebSocket message shape, and the list of fields that can never be renamed because deployed CLIs and cached pages depend on them.
