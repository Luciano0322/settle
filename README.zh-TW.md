# Settle

[English](./README.md) | [繁體中文](./README.zh-TW.md)

為狀態持續變動的系統，維持執行結果的有效性。

當因果輸入改變時，Settle 管理非同步結果是否仍然有效。

> **執行完成，不代表系統已達到穩定狀態（settled）。**

某次執行可能順利完成，但建立這次執行的狀態早已改變。

此時，執行雖然完成，其結果卻可能已不具備影響可觀察狀態的因果資格。

Settle 追蹤因果狀態、執行識別、取代關係（supersession）、因果 commit 資格、
重用與穩定判定（settlement），避免過期結果成為目前的可觀察狀態。

套件名稱與安裝方式：

```bash
npm install @signal-kernel/settle
```

> `@signal-kernel/settle` 目前仍屬實驗性質，尚未發布穩定版本。

---

## 為什麼需要 Settle？

考慮一個執行時間較長的操作：

```text
revision 1
    |
    v
execution A#1 starts
```

在操作完成之前，輸入改變了：

```text
revision 1
    |
    v
execution A#1 ------------------------>
             |
             |
        revision 2
             |
             v
        execution A#2
```

現在 A#1 先完成。

它的 Promise 成功 resolve。

但這並沒有回答真正重要的問題：

> **這份結果，是否仍然屬於目前的狀態？**

如果 A#1 是基於 revision 1 建立的，但系統已經進入 revision 2，
那麼它的結果可能已不再被允許影響可觀察狀態。

```text
A#1 completes
    |
    v
superseded
    |
    v
commit rejected
```

A#2 可能稍後才完成：

```text
A#2 completes
    |
    v
still current
    |
    v
commit accepted
```

Settle 的目的，就是明確表達這項區別。

---

## 核心概念

Settle 將下列狀態視為不同的概念：

```text
completed != committed
completed != settled
cancelled != superseded
resolved  != accepted
```

執行完成回答的是：

> 這個操作是否已經結束？

因果 commit 資格回答的是：

> 它的結果是否仍被允許影響目前的狀態？

穩定判定回答的是：

> 目前的可觀察狀態，是否代表目前的因果狀態？

這些是不同的問題。

---

## Settle 負責什麼

Settle 關注的是執行結果的有效性。

它回答的問題包括：

- 哪個因果狀態建立了這次執行？
- 這次執行是否仍對應目前狀態？
- 它是否已被取代？
- 應用程式提交的這份結果，是否仍擁有 commit 權限？
- 既有的已穩定結果，是否仍可重用？
- 哪些已接受的結果已經失效？
- 哪些必要有效性條件（required validity obligations）尚未滿足？
- 目前的可觀察狀態是否已達到穩定？

核心語意包含：

```text
causal state
revision
execution identity
invalidation
supersession
causal commit eligibility
selective reuse
recomputation
settlement
snapshot continuity
```

---

## Settle 不負責什麼

Settle **不是 workflow engine**。

它不決定：

- 哪個候選結果比較好、正確，或值得提交
- 如何解讀領域分數或模型信心值
- 下一個要執行什麼任務
- workflow 節點如何連接
- 任務應該在何時重試
- 任務在哪裡執行
- 如何分配 worker
- 工作如何排入佇列
- 分支如何匯合
- 如何實作 workflow 的持久執行能力

Settle 不是：

- 排程器
- 任務佇列
- agent framework
- workflow DSL
- 重試系統
- worker runtime
- 持久執行平台
- 資料庫
- 分散式協調系統

既有的執行宿主（host）仍然決定要執行什麼，以及何時執行。

> **應用程式決定什麼結果可以接受。
> 執行宿主決定要執行什麼。
> Settle 決定提交的結果是否仍然有效。**

---

## 設計為既有執行宿主之下的一層

Settle 預期在既有協作與編排系統之下運作，而不是取代它們。

```text
┌───────────────────────────────────────┐
│ Existing execution host               │
│                                       │
│ LangGraph                             │
│ Inngest                               │
│ Temporal                              │
│ custom agent runtime                  │
│ background worker                     │
│ plain async application               │
└───────────────────┬───────────────────┘
                    |
                    | executes work
                    v
             ┌──────────────┐
             │    Settle    │
             │              │
             │ causal state │
             │ execution ID │
             │ validity     │
             │ supersession │
             │ commit       │
             │ settlement   │
             └──────┬───────┘
                    |
                    v
          signal-kernel primitives
```

host 負責：

```text
WHEN
WHERE
WHAT
WHAT NEXT
HOW TO RETRY
HOW TO RESUME
```

Settle 負責：

```text
STILL VALID?
```

---

## Settlement 不等於 Promise settlement

JavaScript 已經使用 `settled` 一詞描述 Promise。

對 Promise 而言：

```text
fulfilled
or
rejected
```

就表示這個 Promise 已經 settled。

Settle 使用的意義更強。

系統達到穩定，表示：

> **所有已接受的可觀察結果，對目前的因果狀態仍具有因果資格；
> 而且不存在尚未滿足、或仍可能改變該可觀察狀態的必要有效性條件。**

穩定判定不保證結果在事實上正確、最佳，或具有高品質。
是否符合應用領域的接受標準，仍由應用程式決定。

這也不要求每個實際執行中的操作都停止。

例如：

```text
old execution A#1 ---------------------------->
                       superseded

new execution A#2 ----------> committed
```

A#1 可能還在執行。

只要 A#1 已永久失去 commit 權限，它最後產生的結果就無法改變目前的可觀察狀態。

因此，系統此時可能已經達到穩定。

> **Settlement 描述的是可觀察狀態的有效性，
> 而不是系統中已經沒有工作在執行。**

---

## 取消不等於正確性

Settle 將取消操作與結果有效性分開處理。

有些操作可以取消。

有些不行。

有些只支援盡力而為的取消。

為了確保正確性，Settle 不能依賴取消操作成功。

```text
execution A#1 starts

revision changes

A#1 becomes superseded

cancel(A#1)
    |
    +-- succeeds
    |
    `-- fails / unsupported
```

無論取消成功與否：

```text
A#1 loses commit authority
```

如果 A#1 稍後 resolve，它的結果仍會被拒絕。

因此：

```text
cancellation
    =
resource management
```

而：

```text
causal commit validation
    =
stale-result correctness
```

---

## 選擇性重用

輸入改變，不代表先前所有工作都失效。

考慮以下情況：

```text
A changes

B depends on A
C does not depend on A
```

那麼：

```text
B
-> invalidated
-> recomputed

C
-> remains valid
-> reused
```

Settle 保留細粒度的重用能力，而不是把每次更新都當成整個 workflow 的重新啟動。

這也是 Settle 建立在 signal-kernel 基礎機制之上的原因之一。

---

## 執行識別

Settle 會區分邏輯上不同的執行。

概念上可以表示為：

```text
A#12
A#13
A#14
```

每次執行可以攜帶足夠的因果資訊，用來判斷：

- 哪個狀態建立了它
- 它是否仍對應目前狀態
- 它是否已被另一次執行取代
- 應用程式提交的結果，是否仍具備因果 commit 資格
- 它在 trace 中如何呈現

執行識別是與正確性有關的概念。

它不一定是全域唯一的 workflow ID 或分散式工作 ID。

---

## Commit 權限

產生一個值，不代表就有權限將它公開為可觀察狀態。

概念上如下：

```text
execution starts
      |
captures causal state
      |
performs work
      |
produces candidate result
      |
      v
validate current causal authority
      |
  ┌───┴─────────┐
  │             │
current     superseded
  │             │
  v             v
commit        reject
```

一次執行可能因為下列原因失去 commit 權限：

- 更新的因果 revision
- 相依條件失效
- 明確宣告失效
- runtime 被 dispose
- restore 邊界
- 應用程式宣告的因果失效

與 commit 權限相關的公開 API 仍屬實驗性質。

但必須維持的不變條件不是實驗性的。

---

## 概念 API

最終 API 尚未凍結。

Phase 8 已實作的公開介面刻意保持精簡：

```ts
import { createSettler } from "@signal-kernel/settle";

const settler = createSettler<Input, Candidate>();
const revision = settler.receive(input);
const execution = settler.associateExecution(revision, {
  requiredForSettlement: true,
});
const settlement = settler.settle(revision);

// The host owns and performs any application work.
const candidate = await hostWork();

// Completion alone changes no observable Settle state.
const submission = execution.submit(candidate);
const output = settler.emit();

const outcome = await settlement;

if (outcome.status === "settled") {
  // This revision has no unsatisfied required obligations.
}
```

Reactive resource 提供選擇性失效能力，但不將執行權交給 Settle：

```ts
const settler = createSettler<State>();

const b = settler.resource({
  input: (state) => state.a,
  run: async (input, context) => hostWork(input, context.signal),
});

const revision = settler.receive(state);

if (b.required(revision)) {
  // The host explicitly decides to start this application work.
  await b.run(revision);
}

const outcome = await settler.settle(revision);
const result = b.valueFor(revision);
if (outcome.status === "settled" && result.status === "valid") {
  act(result.value);
}
```

`resource()` 使用 signal-kernel 的相依追蹤，以及手動驅動的
`@signal-kernel/async-runtime` resource。`receive()` 只評估 reactive 有效性，
不會呼叫 resource 描述中的 `run` callback。選取的輸入改變時，會建立一個限定於該
revision 的必要條件；選取的輸入不變時，則重用已 commit 的輸出，不需 host 執行工作。

預設情況下，兩個選取輸入在以下情況視為相同：兩者都是 JSON 值且內容相等（物件 key 的順序不影響），或兩者是同一個參考。`Map`、`Date`、class instance 等非 JSON 值，以及含有 `undefined` 屬性的物件，只比較參考。若希望物件依內容比較，可選欄位請改用 `null` 或直接省略，不要設為 `undefined`。需要其他規則時，請提供 `equals`。

resource 失效期間，`emit()` 不會公開先前的結果。
這個有效性狀態本身也是 reactive 的，因此依賴它的下游 resource selector 也會失效。
由 host 啟動的 `run(revision)` 成功時，會原子地驗證 revision、公開新結果、
傳播下游有效性，並滿足對應的必要條件。
已被取代 revision 的晚到結果，不能成為可觀察狀態。

`emit()` 讀取目前的結果，下游 selector 也透過它追蹤這個結果。
它不綁定 revision：較新的 revision 到達後，它可能沒有值，也可能回傳較新 revision 的結果。
要針對特定 revision 的結果採取行動前，請改用 `valueFor(revision)` 讀取：

- `{ status: "valid", value }`：該 revision 是最新的，結果也屬於它，
  包括因輸入未改變而重用的結果。
- `{ status: "required" }`：該 revision 是最新的，但 resource 尚未為它產生結果。
- `{ status: "superseded", supersededBy }`：已有較新的 revision，即使這個 resource 的結果沒有改變。
  請改用 `supersededBy` 再讀一次；這不會讓 resource 重新執行。
- `{ status: "disposed" }`：settler 已被 dispose。

`valueFor` 是同步的。請在同一個同步步驟中檢查結果並採取行動，中間不要有 `await`，
這樣檢查與行動之間就不會有較新的 revision 插入。

穩定判定始終限定於指定的 revision：

```ts
const firstRevision = settler.receive(firstInput);
const firstExecution = settler.associateExecution(firstRevision);
settler.require(firstRevision);
const firstSettlement = settler.settle(firstRevision);

const secondRevision = settler.receive(secondInput);

await firstSettlement;
// { status: "superseded", revision: firstRevision, supersededBy: secondRevision }

firstExecution.submit(lateCandidate);
// { status: "rejected", reason: "superseded", ... }
```

revision 的表示方式是不透明的。呼叫端應將 `receive()` 回傳的識別傳回
revision-scoped 操作，而不是檢查其內部結構。
每個 revision 都只屬於一個 settler。傳入其他 settler 的 revision 時，
`require`、`associateExecution` 與 resource `valueFor` 會拋出 `SettlementRevisionError`；
`settle` 與 resource `run` 則會在建立任何執行權限之前，以該錯誤 reject。

`require()` 在穩定評估之前登記有效性條件。回傳 handle 的 `satisfy()` 是冪等操作，
只表示條件現在已成立，不包含或呼叫應用程式工作。
未登記為必要條件的活動，不會阻擋穩定判定。

`associateExecution(revision)` 建立一個獨立、不透明且綁定該 revision 的執行識別。
候選結果只能透過這個 association 提交，因此呼叫端不必自行組裝或重複傳入來源識別欄位。
對於外部執行的工作，`submit(candidate)` 會透過 `settler.emit()` 公開已完成的候選結果；
resource 完成時，則透過自己的 handle 遵循相同的因果驗證與 commit 契約。
Settle 不檢查候選結果的分數、信心值或其他領域內容。

傳入 `{ requiredForSettlement: true }`，會在穩定評估之前登記一個與執行關聯的必要條件。
它不提供手動 `satisfy()` 操作：只有具備因果資格的 `submit(candidate)`，才能在同一個
同步狀態轉換中 commit 候選結果並滿足條件。被拒絕的提交不會進行其中任何一項操作。
未指定此選項的執行仍屬 optional，不會阻擋穩定判定。

Phase 4 會在新 revision 到來時，永久撤銷舊執行的 commit 權限。
舊工作的實際完成時間，不會延後 `superseded` 結果；晚到的候選結果也不能取代可觀察狀態。

Phase 5 完成最小的原子因果驗證與 commit 契約。
提交候選結果與 `receive()` 共用同一個同步順序邊界：要麼候選結果先為自己的 revision
完成 commit；要麼新 revision 先到，過期候選結果會被拒絕，且從未成為可觀察狀態。
公開介面不會在驗證與 commit 之間，提供可保留並於稍後使用的 commit 授權。

Phase 6 保留細粒度的 reactive 重用能力。Settle 辨識哪些 resource 需要目前有效的結果，
並讓穩定判定維持 pending；至於是否、何時呼叫必要 resource 的 `run(revision)`，
仍由 host 決定。

重要的也包括這裡**沒有**什麼。

Settle 不應發展成下列 API：

```ts
defineWorkflow(...)
addNode(...)
addEdge(...)
branch(...)
join(...)
schedule(...)
retry(...)
```

那些屬於工作編排的責任。

---

## 錯誤、取消與 dispose

目前 revision 的必要 resource 執行失敗時，它的 `run(revision)` Promise
與正在等待的 `settle(revision)` Promises 都會以 `SettlementExecutionError` reject。
錯誤保留原始 `cause`、執行識別與因果 revision。
resource 仍維持 required，失敗的候選結果也不會成為可觀察狀態。

同時啟動工作並等待穩定時，應一起處理這兩個 Promise：

```ts
import { SettlementExecutionError } from "@signal-kernel/settle";

try {
  await Promise.all([
    resource.run(revision),
    settler.settle(revision),
  ]);
} catch (error) {
  if (!(error instanceof SettlementExecutionError)) throw error;
  // The host decides whether to retry, use a fallback, or receive new input.
}
```

Settle 不會自動重試。host 明確啟動重試時，會清除該 resource 已記錄的失敗。
重試成功後，新的 `settle(revision)` 呼叫才有機會 fulfill；先前已 rejected 的 Promise
仍保持 rejected。其他必要 resource 與各自的失敗狀態維持獨立。

失敗是否仍具關聯性，會在 Settle 觀察到執行完成時判斷。
已被取代 revision 的晚到 rejection，不能改變它的 `superseded` 結果。
如果失敗已在新輸入到來之前回報，該 rejected settlement Promise 會保留原始錯誤。
同一 revision 內已被新 attempt 取代的執行，或選取輸入已改變的結果，都不會讓目前的
穩定判定失敗。resource 選取的輸入改變，或已 commit 的結果變得可重用時，
也會清除它已記錄的失敗。

`settler.dispose()` 會永久撤銷 commit 權限，以 `SettlerDisposedError` reject
尚在等待的穩定判定，請求 async-runtime 取消工作，並釋放內部 reactive 相依關係。
dispose 是冪等操作。即使 host 工作忽略取消，它的晚到結果也不能 commit。
dispose 之後，既有執行的提交或 pending resource 的完成結果會回報
`{ status: "rejected", reason: "disposed", ... }`。

dispose 之後，新的 `receive`、`require`、`associateExecution` 與 `resource`
呼叫會拋出 `SettlerDisposedError`；新的 resource `run` 呼叫則以該錯誤 reject。
讀取操作保留最後已 commit 的狀態與有效性旗標。
已結束的 settlement Promise 維持原結果。對已被取代 revision 發起的新穩定判定，
仍回報 `superseded`；對已 dispose、但仍具權威性的 revision 發起的呼叫則會 reject，
即使較早的操作已將它判定為 settled，也是一樣。

取消沿用 async-runtime 既有的生命週期，不決定因果資格。
新 revision 會請求取消前一個 revision 的 resource 執行，但 supersession 與 dispose
都不等待工作實際完成。對已被取代的必要工作呼叫 `run`，會拒絕它的候選結果權限，
不呼叫應用程式工作。不需要工作，或 async-runtime 在同一 revision 內取代 attempt 時，
`run` 回傳 `undefined`；選取輸入後來已改變的結果也會被忽略。

透過 `associateExecution` 關聯的外部工作，仍由 host 擁有與管理：
host 處理執行錯誤，並明確提交已接受的結果。
這個 handle 不會引入另一套失敗回報或重試機制。

---

## 生命週期

已實作的生命週期包含下列觀察方法：

```ts
type Settler<Input, Output, Revision> = {
  receive(input: Input): Revision;

  settle(revision: Revision): Promise<SettlementOutcome<Revision>>;

  emit(): Output;

  inspect(): SettlementInspection;

  snapshot(): SettlementSnapshot;

  restore(snapshot: unknown): RestoredSettlement<Output>;

  trace(): readonly SettlementTraceEvent[];

  subscribe(
    listener: (event: SettlementTraceEvent) => void,
  ): () => void;

  dispose(): void;
};
```

這份簡化介面仍屬實驗性質；resource 與 execution association 方法已在前文說明。

實作應由已驗證的行為推動，而不是為了擴大 API 範圍。

---

## Snapshot 與 restore

Snapshot 直接使用 `@signal-kernel/snapshot` 的圖結構相容性檢查、JSON 驗證、
擷取、傳輸與還原能力。Settle 補上重用結果、重建尚未滿足之必要條件所需的有效性狀態。

使用時，需明確提供 settlement definition 與穩定的 resource ID：

```ts
import { createSettler } from "@signal-kernel/settle";
import { decodeJsonSnapshot, encodeJsonSnapshot } from "@signal-kernel/snapshot";

const definition = { id: "search-session", version: "1" };

function createSession() {
  const settler = createSettler<{ query: string }>({ definition });
  const result = settler.resource({
    id: "search-result",
    input: (state) => state.query,
    run: async (query, context) => hostSearch(query, context.signal),
  });
  return { settler, result };
}

const source = createSession();
const revision = source.settler.receive({ query: "reactive systems" });
await source.result.run(revision);
await source.settler.settle(revision);

const serialized = encodeJsonSnapshot(source.settler.snapshot());
const target = createSession();
const restored = target.settler.restore(decodeJsonSnapshot(serialized));

if (target.result.required(restored.revision)) {
  // Only the host starts any work still required after restore.
  await target.result.run(restored.revision);
}
await target.settler.settle(restored.revision);
```

`snapshot()` 擷取目前具權威性的輸入、具備因果資格的已 commit 結果、resource 的因果輸入 key，
以及尚未滿足的手動條件與必要執行條件數量。
它不包含 pending Promise、controller、callback、live error、execution handle
或 runtime reference。失效的 resource 結果，以及來自已被取代 revision 的手動 commit
結果，都不會被還原為目前結果。
應用程式輸入、可重用結果與可重用 resource 輸入 key 必須相容於 JSON；
不支援的 live payload 會導致 `SettlementSnapshotError`，而不是被靜默捨棄。

`restore(document)` 只能套用到尚未接收輸入，且 definition ID、version
與 resource ID 集合相同的新 instance。請先註冊 resource，再執行 restore。
無效文件與不相容的識別，會在初始化目標 instance 之前被拒絕。
回傳的 `revision` 與所有 live handle 只屬於該 instance。
resource 的註冊順序，不決定還原識別或下游有效性傳播。

restore 與 live 評估使用相同的預設輸入相等規則，比較傳輸後的輸入與新的 selector 值。明確提供的 `equals` comparator 仍具有最終判定權。
如果 selector 讀取到還原輸入之外已改變的相依條件，結果就會變成 required，而不是被重用。
selector 與 comparator 必須是純函式。
內部傳播會先達到穩定，再評估 settlement，全程不呼叫應用程式工作。

對於未被序列化的非 resource 工作，restore 也會分別回傳可由 host 操作的 handle：

```ts
for (const condition of restored.manualObligations) {
  // The host verifies the corresponding external validity condition.
  condition.satisfy();
}

for (const obligation of restored.executionObligations) {
  const execution = obligation.associateExecution();
  const candidate = await hostWork();
  execution.submit(candidate);
}
```

手動條件的 handle 是冪等的。執行條件的 `associateExecution()` 會以冪等方式回傳
新的 revision-bound handle，且不提供手動 `satisfy()` 路徑。
只建立 association 不會解除 settlement 的阻擋；只有具備因果資格的候選結果 commit 才會。
擷取 snapshot 不會取消來源 instance，來源稍後完成的工作也不能影響還原後的狀態。
匿名手動條件或執行條件所代表的領域意義，由應用程式負責對應；
Settle 不序列化或推導應用程式工作。

`createSettler({ definition, now })` 接受可選的 clock，讓 snapshot 時間戳記可重現。
Snapshot definition 與 resource 識別維持穩定，live 因果 revision 與 execution 識別
則會為每個 instance 重新建立。
這本身不保證 Temporal Workflow replay 的安全性；host-specific replay 驗證仍屬整合工作。

---

## Restore 隔離

還原 snapshot 會建立新的 live runtime。

```text
runtime A
   |
snapshot
   |
   +----------> runtime B
   |
   `----------> runtime C
```

B 與 C 可以共享序列化的歷史資料。

但不能共享：

- signal
- pending execution
- subscription
- AbortController
- 可變動的 runtime 物件

A 的晚到工作，不能 commit 到 B 或 C。

---

## 可追蹤性

可以透過 `trace()`、`inspect()` 與 `subscribe(listener)` 觀察執行有效性：

```ts
const unsubscribe = settler.subscribe((event) => {
  console.log(event.sequence, event.subject, event.type, event.reason);
});

const events = settler.trace(); // Frozen history snapshot; no live array.
const state = settler.inspect(); // Frozen metadata; no candidate payload or handles.
console.log(state.revisionId, state.obligations, state.resources);

unsubscribe(); // Idempotent; does not discard trace history.
```

事件包含 `version: 1`、event ID、序號、時間戳記、subject，以及因果 revision 的識別與 ID。
execution 事件另包含 execution 識別與 ID；settlement operation 則有各自的
`settlementId`。supersession 連結同時攜帶不透明識別與可讀 ID。
resource 有指定描述 ID 時會使用該 ID，否則產生確定性、無碰撞的本地 ID。
所有可讀 ID 都只供 instance 內關聯資料，不是可跨 instance 傳遞的 commit 權限。

`completed` 表示已產生候選結果，不表示 commit 或通過領域接受判斷。
對手動 handle 而言，submit 就是 host 回報工作完成的時點；
Settle 無法觀察外部工作實際何時開始或結束。
`cancelled` 記錄的是 abort 請求，不代表工作已實際停止。因此晚到結果仍可能被拒絕。

拒絕原因會區分 `stale-revision`、`revoked-authority`（attempt 已被取代或 resource
輸入已改變）與 `disposed`。來自其他 settler 的 revision 請求，會在建立 execution
association 之前回報 `provenance-mismatch`。
執行錯誤以 `failed` 表達，不是對品質的拒絕。
resource 的失效、重用與重新計算事件會說明原因；這些事件都不負責排程應用程式工作。

訂閱只接收未來事件。通知是同步且有序的，會在包含 commit、有效性傳播與必要條件更新的
完整狀態轉換結束後派送。listener 內重入的操作，會把後續通知加入佇列，
不能打斷驗證與 commit。觀察者拋出的例外會被隔離並忽略；觀察者需自行處理回報失敗。
事件描述的是它所記錄的狀態轉換，但 listener 中的讀取，可能看到更早執行的另一個 listener
所造成的較新狀態。訂閱可以在 dispose 之後繼續觀察晚到事件，不再需要時應明確取消訂閱。

`inspect()` 回報目前 revision、dispose 狀態、尚未滿足的必要條件數量、resource，
以及最後一次手動 commit 的來源識別資訊。
被重用的 resource 保留產生它的 revision／execution metadata。
inspection 不公開候選結果資料，也不提供滿足條件或提交結果的方法，
更不會凍結由呼叫端擁有的 payload。

Trace ID 與順序在同一 instance 內具備確定性。
提供 `now()` 時，時間戳記使用該 clock；否則以事件序號作為邏輯時間，而不是實際毫秒數。
注入的 clock 必須是純函式、同步，且回傳有限數值；同一個選項也提供給 snapshot 原生 clock。
snapshot 不保存 trace 歷史或 listener。
restore 會建立新的本地來源識別，並回報可重用的還原狀態，不會恢復來源 execution 的權限。

目前 instance 會把完整 trace 保留在記憶體中；尚未實作有上限的保留策略或持久化。
事件 envelope 有版本，但完整事件分類仍待 host 驗證後再定案。

較廣泛的候選 trace 概念包括：

```text
started
completed
invalidated
pending
resolved
cancelled
reused
recomputed
superseded
rejected
committed
restored
settled
```

重要區別包括：

```text
completed != committed
resolved  != accepted
cancelled != superseded
```

已實作的 trace 可以回答：

- 哪次執行產生了這份結果？
- 哪個因果 revision 建立了它？
- 為什麼結果被拒絕？
- 為什麼先前的工作可以重用？
- 什麼造成了重新計算？
- 哪次執行取代了另一次執行？
- 目前狀態何時變成 settled？

Settle 負責 trace 的語意契約。

它不負責：

- trace 持久化
- dashboard
- LangSmith
- OpenTelemetry exporter

---

## Host 互通性

Phase 10 可執行的參考實作位於 [examples](./examples/README.md)，
另有[驗證紀錄與明確限制](./docs/phase-10-validation.md)。
範圍包含 plain async、真實 LangGraph checkpoint、Inngest SDK 測試引擎，
以及 Temporal 的 Activity-local seam。
Browser smoke 在實際 Chromium 中執行建置後的公開 exports。
這些驗證不代表 production adapter 或 Workflow replay 保證。

與既有執行宿主的互通性，是核心驗證策略。

目標**不是**把 Settle 變成 adapter framework。

目標是證明相同的有效性語意，可以在不同的執行模型下維持成立。

目前的驗證順序：

```text
1. Plain async
2. LangGraph
3. Inngest
4. Temporal
```

---

## Plain async

第一個原生使用 Settle 的範例，不應需要任何 workflow engine。

```text
revision 1
  -> A#1 starts

revision 2 arrives
  -> A#1 superseded
  -> A#2 starts

A#1 completes
  -> rejected

A#2 completes
  -> committed

current state
  -> settled
```

這會建立最小抽象的基礎。

如果 Settle 無法獨立說明這個情境，就還不適合與更大的 runtime 整合。

---

## LangGraph

LangGraph 是第一個真實 workflow host 的驗證目標。

預期的責任邊界如下：

```text
LangGraph
  |
  |- graph topology
  |- node scheduling
  |- threads
  |- checkpoint policy
  |
  v
LangGraph node
  |
  v
Settle
  |
  |- validity
  |- invalidation
  |- supersession
  |- commit
  `- settlement
```

Settle 不負責 LangGraph routing。

LangGraph 的持久狀態可以包含序列化的 Settle 狀態。

但絕不應包含 live Settle instance。

既有的驗證工作位於：

```text
reactive-correction-graph
```

---

## Inngest

Inngest 提供不同的執行模型，包含持久化 step 邊界，以及由 host 擁有的重試與 step 結果重用。

因此，Settle 應透過序列化的狀態延續來運作，而不是假設 runtime 一直存活。

概念上如下：

```text
Inngest step
    |
restore Settle state
    |
receive input
    |
run application work
    |
settle
    |
return output + snapshot
```

Settle 不得重做：

- Inngest 重試
- 持久化 step 排程
- step 結果記憶化（memoization）

整合的目的是驗證相容性，不是把 Inngest 的語意引入 Settle。

---

## Temporal

Temporal 是初期互通性驗證中最嚴格的壓力測試。

它為持久執行與確定性重播，帶來額外要求。

因此，Settle 必須避免讓正確性依賴隱藏、非確定性的行為。

其中一種整合方式，概念上可以是：

```text
Temporal Workflow
       |
       v
    Activity
       |
       v
     Settle
```

未來更深入的整合，可能讓具備確定性的 Settle 有效性狀態，直接參與 workflow 決策。

例如：

```text
revision 12
    |
Activity A#12 scheduled
    |
revision 13 arrives
    |
A#12 superseded
    |
A#12 completes
    |
result delivered
    |
Settle rejects obsolete result
```

Temporal 仍然擁有持久執行的責任。

Settle 負責結果有效性。

Production 等級的 Temporal adapter，不是第一個實驗版本的必要條件。

---

## 整合套件政策

初期 host 整合應維持為範例：

```text
examples/
  plain-async/
  langgraph/
  inngest/
  temporal/
```

不要預設專案需要以下套件：

```text
@signal-kernel/settle-langgraph
@signal-kernel/settle-inngest
@signal-kernel/settle-temporal
```

只有當實際整合經驗顯示存在足夠且可重用的邏輯時，adapter 才應獨立成套件。

優先維持精簡的 host 銜接程式碼。

如果每個 host 都需要龐大的 adapter，反而表示 Settle 的抽象可能有問題。

---

## 參考應用程式

[`reactive-correction-graph`](https://github.com/Luciano0322/reactive-correction-graph)
是 Settle 主要的實際應用驗證專案。

它在 AI workflow 中展示執行有效性行為，包括：

- 選擇性重新計算
- 重用未受影響的工作
- 拒絕過期結果
- 已被取代的非同步執行
- snapshot 狀態延續
- 還原後的 session 隔離
- 多 agent 邊界
- LangGraph 整合

這個專案仍屬應用程式特定的實作。

Settle 不得依賴以下概念：

```text
Agent
LLM
FactCheck
Writer
Correction
LangGraph
```

參考應用程式是抽象成立的證據，不是 Settle 的領域模型。

---

## 與 signal-kernel 的關係

Settle 是建立在 signal-kernel 基礎機制之上的高階語意層。

概念上如下：

```text
@signal-kernel/core
        |
@signal-kernel/async-runtime
        |
@signal-kernel/snapshot
        |
@signal-kernel/settle
        |
application
```

各層的責任不同。

### `@signal-kernel/core`

負責細粒度的 reactive 相依追蹤。

### `@signal-kernel/async-runtime`

負責非同步 reactive 執行的基礎機制。

### `@signal-kernel/snapshot`

負責可序列化的 runtime 狀態延續基礎機制。

### `@signal-kernel/settle`

負責高階的執行有效性與穩定判定語意。

下層套件不得反向依賴 Settle。

---

## 設計限制

Settle 應維持：

- framework-neutral
- domain-neutral
- ESM-first
- 相容於瀏覽器
- 相容於 Node
- 相容於 worker
- SSR-safe
- 需要狀態延續時可序列化
- host 執行需要時具備確定性

Settle core 不得依賴：

- LangGraph
- Inngest
- Temporal
- React
- Vue
- DOM API
- Node-only 基礎設施
- LLM provider
- correction 領域程式碼

---

## 確定性

Settle 應具備確定性運作的能力。

正確性不應依賴隱藏的以下呼叫：

```ts
Date.now()
Math.random()
crypto.randomUUID()
```

clock、ID 產生或其他對 host 敏感的能力，在需要時應可注入，或以確定性方式推導。

這對以 replay 為基礎的執行系統尤其重要。

---

## 實驗狀態

Settle 目前仍在積極設計中。

下列部分刻意尚未凍結：

- execution 註冊 API
- 因果 revision 的表示方式
- 公開的 commit 權限 API
- inspection 契約
- trace 事件分類
- snapshot wrapper API
- host 整合 helper
- 錯誤型別

本專案優先選擇：

```text
small semantics
+
strong invariants
+
multiple external validations
```

而不是：

```text
large API surface
+
speculative flexibility
```

---

## 初期驗證目標

在發布實驗性 `0.1.0` 版本之前，Settle 應展示以下能力：

- 已被取代的執行不能 commit
- 避免過期結果影響狀態，不依賴取消成功
- 目前有效的執行可以 commit
- 未受影響的已穩定工作可以重用
- 選擇性重新計算正常運作
- 過期工作仍在實際執行時，系統也可以達到穩定
- snapshot 能還原相容的有效性狀態
- pending 工作會重建，而不是序列化
- restore 前的工作不能修改 restore 後的狀態
- 還原後的 runtime 彼此隔離
- dispose 會撤銷 commit 權限
- trace 語意維持一致
- plain async 使用方式正常運作
- LangGraph 整合正常運作
- Inngest 互通性已驗證
- Temporal 具備安全的整合邊界

---

## 非目標

Settle 不打算成為：

- Temporal
- Inngest
- LangGraph
- Airflow
- 新的 agent framework
- 分散式排程器
- 工作佇列
- 持久化平台

本專案應持續聚焦在一個問題：

> **當工作還在執行、因果狀態卻已改變時，哪些結果仍然有效？**

---

## 專案方向

Settle 的架構驗證問題不是：

> Settle 能否執行所有類型的 workflow？

而是：

> **執行模型差異很大的系統，能否使用相同的有效性語意，
> 判斷非同步工作是否仍代表目前的狀態？**

如果這一點在 plain async 程式碼、LangGraph、Inngest、Temporal
與其他執行宿主之間都成立，Settle 就完成了它應負責的工作。

---

## 開發與發布

本 repo 使用 pnpm、GitHub Actions 與 Changesets。
對使用者可見、且準備隨套件發布的變更，應包含 changeset，
讓版本與 changelog 更新成為可 review 的歷史紀錄。
尚未完成的發布前行為切片，則先以 commit 與 pull request 記錄，
直到最小核心準備好以 `0.1.0` 發布。

實作順序請參考 [TDD checklist](./docs/TDD-checklist.md)；
CI、Changesets 與 npm 發布流程請參考[發布流程](./docs/RELEASING.md)。
