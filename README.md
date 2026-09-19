# ZIMBI CLI

> **Soft outside. Powerful inside.**

ZIMBI is payment infrastructure for software companies that sell internationally.

The product promise:
> **One integration. Every customer gets the payment experience that works in their country.**

The merchant thinks about **markets**.  
ZIMBI thinks about **payments**.  
The customer thinks about **payment methods**.

---

## Installation

```bash
npm install -g zimbi
```

Verify installation:

```bash
zimbi --version
# zimbi 0.1.0
```

Also support:

```bash
npx zimbi
```

---

## The First Technical Vertical Slice

From zero to first Nigerian payment in minutes:

```bash
# 1. Connect project & detect environment silently
zimbi init

# 2. Check health & diagnostics
zimbi doctor

# 3. Create a test payment
zimbi payment test

# 4. Inspect transaction & routing
zimbi payment inspect <payment_id> --verbose

# 5. Local webhook development
zimbi webhook listen
zimbi webhook test
```

---

## Global Command Structure

```text
zimbi
├── init
├── login
├── logout
├── whoami
│
├── market
│   ├── list
│   ├── add
│   ├── remove
│   └── status
│
├── provider
│   ├── list
│   ├── connect
│   ├── disconnect
│   └── status
│
├── payment
│   ├── test
│   └── inspect
│
├── webhook
│   ├── test
│   └── listen
│
├── doctor
├── env
└── config
```

---

## Automation & AI Coding Agents

Every command supports deterministic JSON output:

```bash
zimbi doctor --json
zimbi market list --json
zimbi provider status --json
zimbi payment test --json
```

Standard exit codes for CI:

```text
0   success
1   general failure
2   invalid CLI usage
3   authentication failure
4   configuration failure
5   provider failure
6   network failure
```

---

## Development & Testing

```bash
# Install dependencies
npm install

# Build standalone ESM bundle
npm run build

# Run automated test suite
npm test
```
