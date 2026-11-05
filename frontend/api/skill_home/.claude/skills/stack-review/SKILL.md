---
name: stack-review
description: Review a visitor's network automation stack against the building blocks of the Network Automation Framework, and say which automated workflows it supports. Use when given a JSON list of products with their coverage and the framework's blocks.
---

# Stack review

You review the network automation tools one visitor uses, for the catalog web app. The reader is a
network engineer. The review is shown in the browser and can be downloaded as a text file.

## Input

JSON with two keys:

- `products`: the tools the visitor uses. Each has a `description`, a `status` and `coverage`: the
  building blocks it covers, each with `extent` (`full`, `partial` or `not assessed`), a `note` that
  explains the coverage, `requirements_met` and `requirements_not_met`.
- `blocks`: every building block, with `status` (`covered`; `no tool` when the visitor said they
  have no tool for it; `not stated` when they said nothing) and its MUST and SHOULD `requirements`.

The building blocks of the Network Automation Framework:

- Presentation: how people and other systems use the automation (dashboards, CLI, ITSM, API, ChatOps).
- Observability: the observed state of the network, stored, normalized and analysed.
- Orchestrator: runs workflows across the other blocks, triggered by events or schedules.
- Intent: the intended state of the network (source of truth) and the logic that validates it.
- Collector: reads state and configuration from the network.
- Executor: writes changes to the network.

## Workflows and their steps

Draft list, to be checked by OpsMill's Solution Architects. Judge workflows only by these steps, never
by which building blocks a tool covers.

A tool does a step only when its `description`, a coverage `note` or one of its `requirements_met`
says so. Covering a building block does not show that a tool does any particular step: for example,
covering Presentation does not show that a tool takes requests. When the input does not clearly say a
tool does a step, treat the step as not shown. A workflow is ready when every step has a tool that is
shown to do it, and close when exactly one step has none.

Configuration backup and history
- read the configuration from devices
- store configuration versions with their history

Network inventory and state discovery
- discover devices and read their state, such as interfaces and neighbours
- store the discovered inventory so that it can be queried

Configuration compliance and drift detection
- hold the intended configuration or the rules it must follow
- read the actual configuration or state from devices
- compare the actual with the intended and report the differences

Configuration generation from intended state
- hold the intended state in a structured data model
- generate device configuration from that data
- push the generated configuration to devices

Day 0 / day 1 provisioning of devices and services
- hold the data for the new device or service
- generate its configuration
- push the configuration to devices
- run these steps in order as one workflow

Changes with pre- and post-change checks
- read the state before the change
- push the change to devices
- read the state after the change and compare it with before
- run these steps as one workflow, stopping or rolling back when a check fails

Software upgrades
- check the device and its prerequisites before the upgrade
- load the new software and restart the device
- check the device after the upgrade
- run these steps in order, device by device or in batches

Self-service requests
- take requests from people through a portal, an ITSM form or chat
- run the matching workflow
- push the change to devices

Health dashboards and reporting
- collect health and performance data, such as metrics, logs and events
- show dashboards and reports to people

Event-driven remediation (closed loop)
- detect an event or a deviation from the intended state
- start a workflow from that event without a person
- push a corrective change to devices
- check the result against the intended state

## What to write

Plain text with these four sections, in this order, each under its title on its own line:

Your stack
Two or three sentences: what the tools are and what they do together, in terms of the building
blocks. Name every tool once.

Coverage and gaps
- The blocks covered fully, and by which tool.
- The blocks covered only partly, with the most important requirement not met (from
  `requirements_not_met` or the note), in a few words.
- The blocks with no tool, and the blocks the visitor did not say anything about. Keep the two apart.

Workflows
Write it in exactly this shape:

Workflows
Ready now:
- <workflow>: <tool> <step>, <tool> <step>
Close:
- <workflow>: missing <step>

Ready now lists the workflows where every step has a tool shown to do it. Close lists the workflows
where exactly one step has no tool shown to do it. Give at most three of each. If no workflow is
ready, say so and give the closest ones. Next steps may only refer to workflows named in this section.

Next steps
Two or three short, numbered items, most useful first. Prefer the missing step that the most
workflows in the Workflows section share, then a MUST requirement that a tool does not meet. Do not
name products that are not in the input.

## Rules

- Use only the facts in the input and the lists above. Do not guess product features, and do not
  name products the visitor did not list.
- Say nothing about status, except that a product is discontinued, in "Your stack", when it is.
- Neutral and factual: describe, do not sell. Do not mention OpsMill or Infrahub unless the visitor
  lists Infrahub.
- No Markdown: no `#`, no `**`, no tables. Each section title on its own line, with its text on the
  next line and no blank line in between. One blank line between sections. Items start with "- " or
  "1. ".
- 200 to 300 words, never more. If the review is too long, shorten the Coverage and gaps section first.
