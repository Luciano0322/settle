# Settle TDD Checklist

這份 checklist 定義 `@signal-kernel/settle` 的建議開發順序。

它以 [RFC-settle.md](./RFC-settle.md) 的四條 normative validity contracts
為核心，採用垂直切片的 red–green 流程。清單中的概念介面名稱仍屬探索性質，
不代表公開 interface 已經凍結。

## TDD 執行規則

每一個 checkbox 都是一個獨立的垂直切片：

1. 先透過已確認的公開 seam 寫一個 failing test。
2. 確認測試是因缺少目標行為而 red，而不是測試配置錯誤。
3. 只實作足以讓該測試 green 的最小行為。
4. 執行完整既有 test suite。
5. 再進入下一個 checkbox。

測試必須遵守下列原則：

- 測試 caller 可觀察的行為，不測 private state 或內部資料結構。
- 不 mock Settle 自己的 module 或內部 collaborator。
- 只在 host-owned async work、外部系統、clock 或 ID source 等 seam 使用 fake。
- 不用 timeout 或 sleep 證明 Promise 仍 pending；使用受控 deferred primitive。
- 不斷言內部 callback 次數或演算法步驟。
- 一次只新增一個行為測試及其最小 implementation。
- 結構性 refactor 留到階段性 review，不混入 red–green cycle。

## 公開測試 seam

第一個測試開始前，應先確認測試所跨越的 public seam。最小需要表達的
caller 能力是：

- 建立 causal revision。
- 將 host-owned execution 關聯至 causal revision。
- 表達 required obligation。
- 透過 execution association 提交 application 已選擇的 opaque candidate result。
- 以單一操作原子地驗證 causal commit eligibility 並 commit 或拒絕 candidate。
- 等待指定 revision 的 settlement outcome。
- 讀取 observable state。

概念上的使用方式如下：

```ts
const revision = settler.receive(input);
const execution = settler.associateExecution(revision, {
  requiredForSettlement: true,
});
const settlement = settler.settle(revision);

const candidate = await hostWork();
execution.submit(candidate);

const outcome = await settlement;
```

Phase 2 已確認 `require(revision)` / `obligation.satisfy()` 這個最小 seam。
`require()` 只登記 validity condition，不接收 application callback；required
obligation 應在該 revision 的 settlement evaluation 前登記。

Phase 3 採用 `associateExecution(revision)` 回傳 revision-bound execution handle，
並由該 handle 的 `submit(candidate)` 保留 execution 與 revision provenance。
這是目前最小公開 seam，仍需在 host interoperability 階段驗證是否足夠。

Phase 5 以 `requiredForSettlement: true` 建立 execution-associated obligation。
這個 obligation 不向 host 暴露 `satisfy()`；只有有效 `submit(candidate)` 能在
observable commit 的同一個 transition 內滿足它。一般 validity condition 仍使用
Phase 2 的手動 obligation seam。

Application 決定什麼結果具有 domain acceptance，host 決定提交什麼；Settle
將 candidate payload 視為 opaque data，不進行 ranking、scoring、quality
judgment，也不從 model confidence 推導 commit authority。

手動 execution 透過 `submit()` 進入 Settle-controlled
causal-validation-and-commit transition；Phase 6 resource 的 `run()` 完成後
也必須經過同樣的原子驗證與提交。
公開 interface 不應提供可在驗證後保留、並於未來才使用的 commit authority，
否則會形成 RFC 所禁止的 check-then-commit race。

---

## Phase 0：測試與 package 基礎

- [x] 建立 TypeScript package、test runner、typecheck 與 build。
- [x] 接入最新版相容的 `signal-kernel` 與 async-runtime。
- [x] 建立只使用 package public exports 的 black-box test 目錄。
- [x] 建立 controlled deferred helper，以確定性方式控制 host execution 完成順序。
- [x] 加入 dependency/import guard，避免核心依賴 workflow、agent、model provider 或特定 host 套件。
- [x] 驗證空白 package 可在 Node ESM 中 import。

Phase 0 不實作 Settle domain behavior。

## Phase 1：第一顆 tracer bullet

目標是以最小端到端路徑建立 revision-scoped settlement。

- [x] **Red:** `receive()` 產生一個 causal revision。
- [x] **Green:** 實作最小 immutable revision identity。
- [x] **Red:** 沒有 required obligation 的 revision，`settle(revision)` 回傳
      `{ status: "settled", revision }`。
- [x] **Green:** 實作最小 settlement evaluation。
- [x] **Red:** settlement outcome 回報的是 caller 指定的 revision。
- [x] **Green:** 保持 revision-scoped outcome，不引入 current/latest 隱式行為。

### Phase 1 exit criterion

一個沒有 required obligation 的 revision 可以透過公開 seam 完成 settlement，
且 outcome 明確識別該 revision。

## Phase 2：required obligation 阻擋 settlement

- [x] **Red:** revision 有一個 unsatisfied required obligation 時不能 settled。
- [x] **Green:** 加入最小 obligation bookkeeping。
- [x] **Red:** host 滿足 obligation 後，既有的 `settle(revision)` 才能完成。
- [x] **Green:** settlement evaluation 能被 validity change 喚醒。
- [x] **Red:** 多個 required obligations 只滿足其中一部分時仍不能 settled。
- [x] **Green:** 支援 obligation 集合。
- [x] **Red:** optional 或 non-required activity 不阻擋 settlement。
- [x] **Green:** 區分 settlement obligation 與一般 execution activity。
- [x] **Red:** Settle 在整個流程中沒有呼叫 application executor。
- [x] **Green:** obligation 只代表 validity condition，不保存 executable callback。

### Phase 2 exit criterion

已證明 normative contract 2：只要 required obligations 尚未全部滿足，
revision 就不能 settled；Settle 也不會因此接管 application execution。

## Phase 3：execution 與 candidate identity

- [x] **Red:** host 可以將 execution 關聯至恰好一個 causal revision。
- [x] **Green:** 加入 execution identity 與 revision association。
- [x] **Red:** application 選擇的 opaque candidate 透過 execution association
      提交時，保留 identified execution 與 causal revision provenance。
- [x] **Green:** submission 從 execution association 取得 provenance，不要求
      caller 重複組裝已由 association 決定的 identity。
- [x] **Public type surface:** 沒有 identified execution association 的 candidate 無法進入
      causal commit evaluation。
- [x] **Interface:** public submission seam 只存在於已建立 association 的 execution。
- [x] **Red:** candidate completion 不會自動成為 observable commit。
- [x] **Green:** 只有 Settle-controlled submission transition 才能更新 observable state。
- [x] **Regression:** candidate payload、score 或 model confidence 不會改變 causal
      commit eligibility。
- [x] **Interface:** Settle 將 candidate payload 視為 opaque data，不實作 domain
      ranking、quality judgment 或 acceptance policy。

不要為了測試 identity mismatch 而刻意設計讓 caller 能任意拼裝 execution ID
與 revision ID 的寬介面。若選定的 public seam 使錯配在型別或 handle 結構上
無法表示，就以 public type-surface test 證明；只有接收 serialized/untrusted
identity 的 adapter 才需要 runtime malformed-input rejection test。

### Phase 3 exit criterion

已證明 normative contract 3：每個可進入 commit evaluation 的 candidate
都有 identified execution 與 causal revision provenance。此階段不宣稱 candidate
具有 domain correctness，也不讓 Settle 判斷 candidate quality。

## Phase 4：revision supersession

- [x] **Red:** `settle(N)` 等待期間收到 N+1，結果是
      `{ status: "superseded", revision: N, supersededBy: N + 1 }`。
- [x] **Green:** revision change 終止舊 revision 的 settlement operation。
- [x] **Regression:** `settle(N)` 不會改成等待 N+1；host 可另外呼叫
      `settle(N + 1)`。
- [x] **Invariant:** 每個 settlement operation 固定持有自己的 revision scope，
      新舊 settlement operations 的狀態彼此獨立。
- [x] **Regression:** N 的 host execution 即使仍在執行，也不阻擋
      `settle(N)` 回報 superseded。
- [x] **Invariant:** physical completion/cancellation 與 semantic supersession 分離。
- [x] **Red:** N 的 late candidate 不能成為 N+1 的 observable state。
- [x] **Green:** supersession 永久撤銷舊 execution 的 causal commit authority，
      不對 candidate 內容做品質判斷。
- [x] **Regression:** 同一 revision 的多個 settlement callers 得到一致 outcome。
- [x] **Invariant:** settlement termination 可以安全地重複觀察。

### Phase 4 exit criterion

已證明 normative contract 1：`settle(revision)` 只終止為該 revision 的
`settled` 或 `superseded`，不會自動跟隨新 revision。

## Phase 5：atomic validation and commit

這是最小核心中風險最高的部分。測試必須跨越公開 submission seam，
不能直接呼叫 private validation 與 private commit。此處的 validation 專指
causal commit eligibility；application 已先決定要提交哪個 opaque candidate，
Settle 不判斷其品質、真實性或 model confidence。

- [x] **Regression:** candidate 先 commit、之後才 receive N+1 時，commit 明確屬於 N。
- [x] **Invariant:** submission 在單一不可分割的狀態轉換內完成驗證與寫入。
- [x] **Regression:** receive N+1 先發生時，N 的 candidate 必須被拒絕。
- [x] **Invariant:** revision change 與 candidate submission 經過同一 serialization point。
- [x] **Regression:** rejected stale candidate 從未短暫出現在 observable state。
- [x] **Invariant:** 不使用先驗證、再非同步寫入的兩階段流程。
- [x] **Regression:** rejected stale candidate 不會滿足目前 revision 的 required
      execution 或寫入 observable state。
- [x] **Invariant:** causal rejection 不執行 execution-associated obligation
      satisfaction；superseded revision 的 settlement outcome 優先於其舊 obligation。
- [x] **Red:** causally eligible candidate 成功 commit 時，相關 obligation 不會在
      commit 前或 commit 後留下可觀察的中間狀態。
- [x] **Green:** observable commit 與 associated obligation satisfaction 屬於同一
      atomic state transition。
- [x] **Regression:** 未指定 `requiredForSettlement` 的 execution 維持 optional，
      不會自行阻擋 settlement。
- [x] **Public type surface:** execution handle 無法取得可延後使用的 commit
      authorization。
- [x] **Interface:** execution handle 只暴露單一 causal-validation-and-commit
      operation `submit(candidate)`。
- [x] **Exhaustive ordering:** 對兩個同步狀態轉換的全部可能先後順序進行測試，
      證明每次競爭只能線性化為：
  - commit 先贏；或
  - supersession 先贏。
- [x] **Invariant:** 排除 stale candidate 成為 observable state 的第三種結果。

### Phase 5 exit criterion：minimum Settle core

四條 normative validity contracts 都已由 public-seam black-box tests 證明：

1. `settle(revision)` 終止為 `settled` 或 `superseded`。
2. required obligations 未滿足時 revision 不能 settle。
3. candidate result 具有 identified execution 與 causal revision。
4. candidate 的 causal commit eligibility validation 與 observable commit 對
   causal revision changes 是 atomic。

完成這個 milestone 後，才開始擴充 signal-kernel reactive behavior、snapshot
及 host interoperability。

## Phase 6：reactive invalidation 與 selective reuse

- [x] A 改變時，依賴 A 的 B 被 invalidated。
- [x] B 的 invalidation 使先前 accepted result 對新 revision 失去 causal
      eligibility，並記錄 unsatisfied required validity obligation。
- [x] host 決定是否以及如何執行 application work 來滿足該 obligation。
- [x] 與 A 無關的 C 保留有效 observable result。
- [x] 被 reuse 的 C 不要求 host 重新執行。
- [x] 舊 B execution 的 late candidate 無法 commit。
- [x] 新 B candidate 的 causal commit 與相應 obligation satisfaction 是同一
      atomic transition。
- [x] downstream validity propagation 持續到穩定。
- [x] internal reactive recomputation 可以發生，但不呼叫 application work。
- [x] obsolete、仍在執行但已不 required 的 work 不阻擋目前 revision settlement。
- [x] 同一 dependency 反覆 invalidation 不會遺失或重複計算 obligation。

### Phase 6 exit criterion

signal-kernel 的細粒度 dependency behavior 已被保留；Settle 能辨識哪些
reactive validity conditions 尚未滿足，但是否以及如何執行 application work
仍由 host 決定。

## Phase 7：error、dispose 與 cancellation

- [x] physical cancellation 失敗不影響 stale-result correctness。
- [x] superseded execution 的 late rejection 不會把 `superseded` 改成 operational failure。
- [x] `dispose()` 永久撤銷所有 pending execution 的 commit authority。
- [x] dispose 後的 candidate 不可寫入 observable state。
- [x] dispose 是 idempotent。
- [x] current revision 的 required resource execution failure 以
      `SettlementExecutionError` reject `run()` 與正在等待的 `settle(revision)`，
      保留原始 `cause`、execution identity 與 causal revision。
- [x] failure 不滿足 obligation，也不自動 retry；host 明確 retry 成功後，
      新的 settlement operation 才可 settled，已 rejected Promise 不會復活。
- [x] execution failure 與 receive N+1 以 Settle 觀察到的 transition 順序決定；
      尚未被觀察的 Promise rejection 不會推翻已發生的 supersession。
- [x] disposal reject 尚在等待的 settlement；已 fulfilled/rejected Promise
      維持原結果。dispose 後的新 `settle()` 對 superseded revision 仍回報
      superseded，對 authoritative revision 則 reject `SettlerDisposedError`。
- [x] disposed instance 不接受新 input、obligation、execution、resource 或 run。
- [x] cancellation 通知之前先撤銷 authority，避免 host callback reentrancy 提交。
- [x] superseded revision 的 `run()` 不呼叫 application work 或取消目前 execution。
- [x] 同 revision 被新 attempt 取代或 input 已改變的 late failure，不影響目前 settlement。
- [x] 某一 resource retry 不清除其他 required resource 的 failure。

### Phase 7 exit criterion

錯誤、supersession 與 disposal 的先後順序已有 public-seam tests 保護；
Settle 直接沿用 async-runtime 的 cancellation 與 current-attempt error 機制，
host 仍擁有 execution 與 retry 決策。`settle()` 成功結果維持 settled/superseded，
operational failure 透過 Promise rejection 表達。

## Phase 8：snapshot 與 restore

- [x] settled observable state 可以 snapshot 並 restore。
- [x] snapshot 不包含 live Promise、AbortController 或 execution object。
- [x] snapshot 時 unsatisfied required validity obligations 在 restore 後重建，
      不序列化或推導 application work。
- [x] restore 不自行啟動 application execution。
- [x] restore 前 execution 的 late candidate 不能 commit 到 restored instance。
- [x] 由同一 snapshot restore 的兩個 instances 完全隔離。
- [x] 不相容 definition/schema 的 snapshot 被拒絕。
- [x] restored reusable result 不產生不必要的 validity obligation。
- [x] snapshot 的 definition/node/resource IDs 與可注入 clock 在 restore 後
      可重現；live revision/execution identity 重新建立且彼此隔離。
- [x] 手動 obligation 還原為新的 idempotent satisfy handle；required execution
      obligation 只能透過新 execution 的有效 commit 滿足。
- [x] selector 的外部依賴改變時，不 reuse 舊 causal input key 的結果。
- [x] restore 尊重明確指定的 input comparator，預設以 JSON transfer key 重新綁定。
- [x] 不同 resource 註冊順序下，downstream validity propagation 仍持續至穩定。
- [x] malformed counts、缺少 state 或不符 resource ID 集合時，在初始化前拒絕。

### Phase 8 exit criterion

直接沿用 `@signal-kernel/snapshot` 的 capture/restore、JSON codec 與相容性檢查。
Settle 只補 validity metadata、causal key 檢查與 obligation 重建；restore 僅能
套用到已註冊相同 resources、但尚未 receive 的新 instance。

固定 snapshot clock 與穩定 serialized identities 已驗證；這不等同於完成
Temporal Workflow deterministic replay，host-specific replay 驗證仍屬 Phase 10。

## Phase 9：trace 與 inspection

- [x] trace 能回答 candidate 的 execution identity 與 causal revision。
- [x] trace 區分 `completed`、`committed` 與 `rejected`。
- [x] causal rejection 明確區分 stale revision、identity/provenance mismatch、
      revoked authority 與 disposal，不使用模糊的 quality rejection。
- [x] trace 區分 execution supersession 與 settlement-operation supersession。
- [x] trace 區分 `cancelled` 與 `superseded`。
- [x] trace 能說明 invalidation、reuse 與 recomputation 的原因。
- [x] trace ordering 在 injectable clock 與 deterministic instance-local IDs 下可重現。
- [x] inspection 不提供繞過 atomic commit 的修改能力。
- [x] trace listener 的 reentrancy 不會破壞 causal-validation-and-commit atomicity。

已透過公開 `trace()`、`inspect()`、`subscribe(listener)` 驗證；時間沿用
`now()`，ID 使用可重現序號，不新增 ID generator 設定。inspection 僅提供
唯讀 metadata，不複製或凍結 candidate payload；通知於完整同步轉換後派送。

identity mismatch 由 opaque readonly execution handle 的型別契約防止；
runtime 的 foreign revision 入口以 `SettlementRevisionError` 與
`provenance-mismatch` trace 拒絕，不為測試新增任意 candidate envelope seam。
另驗證 async-runtime 完成與 Settle commit 之間被新 attempt 取代的交錯，
確保已 revoked 的 execution 不會因底層已 resolve 而恢復 commit authority。

trace 保留於 instance 記憶體，未實作 bounded retention／持久化；完整
taxonomy 與 host-specific replay 保證不屬本階段。注入的 trace clock 須
pure、同步且回傳 finite number；未注入時以 event sequence 作為 logical time。

Trace taxonomy 尚未凍結，因此先測必要語義資訊，不提前鎖死所有 event 名稱。

## Phase 10：host interoperability

- [ ] 建立 plain-async changing-input reference example。
- [ ] 將 `reactive-correction-graph` 遷移至 Settle，維持既有 causal-validity
      regression baseline，不把 settlement 當成 correction quality 證明。
- [ ] 建立 LangGraph example，證明 Settle 不擁有 graph topology 或 node execution。
- [ ] 建立 Inngest prototype，證明 Settle 不擁有 retry 或 durable step execution。
- [ ] 建立 Temporal prototype，驗證 deterministic replay 或 Activity-local seam。
- [ ] 通過 browser smoke test。
- [ ] 通過 Node ESM smoke test。
- [ ] 所有 examples 只使用 package public exports。
- [ ] core package import guard 拒絕 host/framework/domain dependencies。

## 階段性 review

在 Phase 5、Phase 6、Phase 8 與 Phase 10 結束後各進行一次 review：

- 檢查 tests 是否仍只跨越已確認的公開 seam。
- 移除因 interface 探索留下的重複或過度暴露能力。
- 檢查 module 是否以小 interface 隱藏 validity、obligation 與 atomic commit 複雜度。
- 檢查 Settle 是否意外接管 application execution、retry、routing 或 persistence。
- 檢查 Settle 是否開始解讀 candidate payload、model confidence、domain score
  或 correction quality，並據此建立 acceptance policy。
- 檢查 terminology 是否符合 `CONTEXT.md`。
- 完成 review 後才進行結構性 refactor，並以既有 black-box suite 保護行為。

## 明確暫緩的測試

以下語義仍在 RFC 中標為 deferred，不應在未決定前用測試意外固定：

- execution-association 與 candidate-submission 的最終方法名稱及資料形狀。
- causal revision 的具體表示方式。
- supersession 後 `emit()` 的完整語義。
- 完整 trace taxonomy。
- `/testing` public subpath。
- 特定 host adapter package。
