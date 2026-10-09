# pi-advisor

Pi extension providing an Executor/Advisor consultation flow, with an optional typed-decision screening layer and optional Herdr integration.

## Language

**JEV transport**: The stored selection of how pi-advisor reaches a decision model, identified by the wire contract and the vendor route it belongs to. _Avoid_: provider, backend, domain

**JEV provider**: The concrete service chosen for screening and the turn gate, whether built into pi-advisor or supplied by the user. _Avoid_: transport, model, vendor

**System One–compatible endpoint**: A decision-model API that accepts a state and typed questions and returns typed answers with calibrated confidence, in the shape TypeSafe's System One contract defines. _Avoid_: Jev-compatible provider, TypeSafe-compatible API, custom provider

**Base URL**: The root address of a System One–compatible endpoint, before the contract's own path is appended. _Avoid_: domain, host, endpoint URL, gateway

**Decision model**: A model that returns typed answers and probabilities rather than generated text. _Avoid_: decision API, Jev model, classifier
