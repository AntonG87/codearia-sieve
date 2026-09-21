# codearia-sieve. Vision

*A sieve lets through what you need and holds back everything else. That is
exactly what the tool does.*

---

## The thought it starts from

Today, when an agent needs a page from the web, it goes there itself. It
downloads a hundred kilobytes of markup, menus, consent banners, a footer with
a copyright line and three ad slots. Then it pays for all of that in tokens
and tries to find, in that pile, the one paragraph it came for.

This is backwards. A model that costs real money per thousand tokens is doing
a janitor's job: separating content from wrapping.

The idea is simple: **move that job out of the model.** One call, and the
agent gets not a page but ready material: clean, structured, in exactly the
shape the caller needs.

## What changed in September 2026

On September 15 Jev shipped, the first public System One model. It does not
write text at all: it takes state and typed questions and returns decisions
with probabilities. It costs four cents per million input tokens and answers
in a fraction of a second.

It has properties that change everything for this problem. Jev has 32 000
tokens for state. Accuracy drops when the state carries irrelevant material;
the authors call this context rot and say so themselves. It does not count.
It reads dates as text, not as ordered values.

In other words: **the fastest and cheapest decision model needs the most
careful input.** You cannot hand it a whole page. You cannot hand it markdown
made for human reading either: dates stay strings, numbers stay prose, and
three paragraphs the question never touches are still there.

Nobody prepares context for this today. Every existing "page to markdown"
tool solves "make it readable". "Make it decidable" is unclaimed.

## What it looks like

![The pipeline](diagrams/01-pipeline.webp)

*Eight steps from a URL to state. A model is needed on one of them, and only
if you plug one in.*

![Today and with Sieve](diagrams/02-today-vs-sieve.webp)

*Left: how an agent works now. Right: what this is for.*

## What Sieve does

A request comes in: here is a page, here is the task. Sieve fetches it and
returns not text but **state ready for questions**:

- the wrapping is gone, the material stays;
- dates are pulled out of prose into fields, already as dates;
- numbers are computed and given units instead of being left as strings;
- the material is cut into chunks, each fitting the model's budget;
- every chunk carries where it came from, so the answer can be checked;
- everything unrelated to the task is dropped, not "kept just in case".

The agent gets the result and asks its questions. It spends no tokens on
parsing, pays no generative price for cleaning, and risks no accuracy over
junk in the context.

## Two forms of one product

**Markdown for reading.** The classic mode: a page becomes a clean Markdown
document. This is what a generative model and a human need.

**State for decisions.** Our own mode: the same material, assembled for a
System One model. Fields instead of prose, chunks under budget, computed
values, links back to the source.

Many tools do the first. Nobody does the second, and it becomes necessary
right now, as decisions move out of large models into a class of their own.

## Who needs it

People who build agents and have already seen the bill. People who run
classification over other people's pages: competitor monitoring, lead scoring,
fact checking, SEO and GEO audits. People who want to hand decisions to a
cheap model and trip every time over preparing its input.

And us. Codearia has an academy, tools in the workshop and plans for a public
page audit. Sieve is the layer all of that stands on. We are its first and
most demanding user, and that is the best test there is.

## How it is distributed

Open source, MIT, no hosting. Decided on September 21, 2026: the paid-service
plan was dropped. The tool installs into an agent with one line
(`npx codearia-sieve` as an MCP server) or into a project as a library. What
brings people is that it runs without a model or an API key and gives the same
result on the same input every time.

## What it grows into

First, one call: give a page, get state.

Then a task instead of a URL: "collect everything about this company from
these sources and prepare it for questions". The tool crawls, decides what is
relevant and returns the result.

Then change watching: follow pages and report not "the page changed" but "here
is what changed in substance, here is the new state".

At some point it stops being a parser. It becomes the layer between the web
and agents: the place where raw material becomes decision-ready.

---

## In one sentence

Models have learned to decide cheaply. What is left is to prepare their
material just as cheaply. Sieve is about that.
