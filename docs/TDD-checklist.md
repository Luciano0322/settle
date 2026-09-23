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

## 待確認的公開測試 seam

第一個測試開始前，應先確認測試所跨越的 public seam。最小需要表達的
caller 能力是：

- 建立 causal revision。
- 將 host-owned execution 關聯至 causal revision。
- 表達 required obligation。
- 提交帶 execution identity 與 causal revision 的 candidate result。
- 以單一操作原子地接受或拒絕 candidate。
- 等待指定 revision 的 settlement outcome。
- 讀取 observable state。

概念上的使用方式如下：

```ts
const revision = settler.receive(input);
const execution = settler.associateExecution(revision, obligation);

const commit = execution.submit(candidate);
const outcome = await settler.settle(revision);
const output = settler.emit();
```

`associateExecution()`、`submit()` 和 `obligation` 的具體表示方式尚未定案。
測試不得因這段示意碼而提前鎖死方法名稱。

`submit()` 應表達單一 Settle-controlled validation-and-commit transition。
公開 interface 不應提供可在驗證後保留、並於未來才使用的 commit authority，
否則會形成 RFC 所禁止的 check-then-commit race。

---

## Phase 0：測試與 package 基礎

- [ ] 建立 TypeScript package、test runner、typecheck 與 build。
- [ ] 接入最新版相容的 `signal-kernel` 與 async-runtime。
- [ ] 建立只使用 package public exports 的 black-box test 目錄。
- [ ] 建立 controlled deferred helper，以確定性方式控制 host execution 完成順序。
- [ ] 加入 dependency/import guard，避免核心依賴 workflow、agent、model provider 或特定 host 套件。
- [ ] 驗證空白 package 可在 Node ESM 中 import。

Phase 0 不實作 Settle domain behavior。

## Phase 1：第一顆 tracer bullet

目標是以最小端到端路徑建立 revision-scoped settlement。

- [ ] **Red:** `receive()` 產生一個 causal revision。
- [ ] **Green:** 實作最小 immutable revision identity。
- [ ] **Red:** 沒有 required obligation 的 revision，`settle(revision)` 回傳
      `{ status: "settled", revision }`。
- [ ] **Green:** 實作最小 settlement evaluation。
- [ ] **Red:** settlement outcome 回報的是 caller 指定的 revision。
- [ ] **Green:** 保持 revision-scoped outcome，不引入 current/latest 隱式行為。

### Phase 1 exit criterion

一個沒有 required obligation 的 revision 可以透過公開 seam 完成 settlement，
且 outcome 明確識別該 revision。

## Phase 2：required obligation 阻擋 settlement

- [ ] **Red:** revision 有一個 unsatisfied required obligation 時不能 settled。
- [ ] **Green:** 加入最小 obligation bookkeeping。
- [ ] **Red:** host 滿足 obligation 後，既有的 `settle(revision)` 才能完成。
- [ ] **Green:** settlement evaluation 能被 validity change 喚醒。
- [ ] **Red:** 多個 required obligations 只滿足其中一部分時仍不能 settled。
- [ ] **Green:** 支援 obligation 集合。
- [ ] **Red:** optional 或 non-required activity 不阻擋 settlement。
- [ ] **Green:** 區分 settlement obligation 與一般 execution activity。
- [ ] **Red:** Settle 在整個流程中沒有呼叫 application executor。
- [ ] **Green:** obligation 只代表 validity condition，不保存 executable callback。

### Phase 2 exit criterion

已證明 normative contract 2：只要 required obligations 尚未全部滿足，
revision 就不能 settled；Settle 也不會因此接管 application execution。

## Phase 3：execution 與 candidate identity

- [ ] **Red:** host 可以將 execution 關聯至恰好一個 causal revision。
- [ ] **Green:** 加入 execution identity 與 revision association。
- [ ] **Red:** execution/revision identity 正確的 candidate 可以 commit。
- [ ] **Green:** 實作最小 candidate submission transition。
- [ ] **Red:** 未識別 execution 的 candidate 被拒絕。
- [ ] **Green:** submission 必須找到有效 execution association。
- [ ] **Red:** execution identity 正確但 causal revision 不符的 candidate 被拒絕。
- [ ] **Green:** commit evaluation 同時驗證兩種 identity。
- [ ] **Red:** candidate completion 不會自動成為 observable commit。
- [ ] **Green:** 只有 Settle 接受後才更新 observable state。
- [ ] **Red:** rejected candidate 不會滿足 required obligation。
- [ ] **Green:** obligation satisfaction 與成功 commit 屬於同一狀態轉換。

### Phase 3 exit criterion

已證明 normative contract 3：每個可進入 commit evaluation 的 candidate
都有 identified execution 與 causal revision，匿名或錯配的 candidate 無法 commit。

## Phase 4：revision supersession

- [ ] **Red:** `settle(N)` 等待期間收到 N+1，結果是
      `{ status: "superseded", revision: N, supersededBy: N + 1 }`。
- [ ] **Green:** revision change 終止舊 revision 的 settlement operation。
- [ ] **Red:** `settle(N)` 不會改成等待 N+1。
- [ ] **Green:** 每個 settlement operation 固定持有自己的 revision scope。
- [ ] **Red:** host 可另外呼叫 `settle(N + 1)`。
- [ ] **Green:** 新舊 settlement operations 的狀態彼此獨立。
- [ ] **Red:** N 的 host execution 即使仍在執行，也不阻擋 `settle(N)` 回報 superseded。
- [ ] **Green:** physical completion/cancellation 與 semantic supersession 分離。
- [ ] **Red:** N 的 late candidate 不能成為 N+1 的 observable state。
- [ ] **Green:** supersession 永久撤銷舊 execution 的 commit authority。
- [ ] **Red:** 同一 revision 的多個 settlement callers 得到一致 outcome。
- [ ] **Green:** settlement termination 可以安全地重複觀察。

### Phase 4 exit criterion

已證明 normative contract 1：`settle(revision)` 只終止為該 revision 的
`settled` 或 `superseded`，不會自動跟隨新 revision。

## Phase 5：atomic validation and commit

這是最小核心中風險最高的部分。測試必須跨越公開 submission seam，
不能直接呼叫 private validation 與 private commit。

- [ ] **Red:** candidate 先 commit、之後才 receive N+1 時，commit 明確屬於 N。
- [ ] **Green:** submission 在單一不可分割的狀態轉換內完成驗證與寫入。
- [ ] **Red:** receive N+1 先發生時，N 的 candidate 必須被拒絕。
- [ ] **Green:** revision change 與 candidate submission 經過同一 serialization point。
- [ ] **Red:** rejected stale candidate 從未短暫出現在 observable state。
- [ ] **Green:** 不使用先驗證、再非同步寫入的兩階段流程。
- [ ] **Red:** public interface 無法取得可延後使用的 commit authorization。
- [ ] **Green:** interface 只暴露一次性的 validation-and-commit operation。
- [ ] **Red:** 以大量確定性交錯順序或 property test 證明每次競爭只能線性化為：
  - commit 先贏；或
  - supersession 先贏。
- [ ] **Green:** 排除 stale candidate 成為 observable state 的第三種結果。

### Phase 5 exit criterion：minimum Settle core

四條 normative validity contracts 都已由 public-seam black-box tests 證明：

1. `settle(revision)` 終止為 `settled` 或 `superseded`。
2. required obligations 未滿足時 revision 不能 settle。
3. candidate result 具有 identified execution 與 causal revision。
4. candidate validation 與 observable commit 對 causal revision changes 是 atomic。

完成這個 milestone 後，才開始擴充 signal-kernel reactive behavior、snapshot
及 host interoperability。

## Phase 6：reactive invalidation 與 selective reuse

- [ ] A 改變時，依賴 A 的 B 被 invalidated。
- [ ] B 的 invalidation 產生 required recomputation obligation。
- [ ] 與 A 無關的 C 保留有效 observable result。
- [ ] 被 reuse 的 C 不要求 host 重新執行。
- [ ] 舊 B execution 的 late candidate 無法 commit。
- [ ] 新 B candidate commit 後滿足相應 obligation。
- [ ] downstream validity propagation 持續到穩定。
- [ ] internal reactive recomputation 可以發生，但不呼叫 application work。
- [ ] obsolete、仍在執行但已不 required 的 work 不阻擋目前 revision settlement。
- [ ] 同一 dependency 反覆 invalidation 不會遺失或重複計算 obligation。

### Phase 6 exit criterion

signal-kernel 的細粒度 dependency behavior 已被保留；Settle 能辨識 required
recomputation，但 application work 仍由 host 執行。

## Phase 7：error、dispose 與 cancellation

已由 RFC 決定的部分：

- [ ] physical cancellation 失敗不影響 stale-result correctness。
- [ ] superseded execution 的 late rejection 不會把 `superseded` 改成 operational failure。
- [ ] `dispose()` 永久撤銷所有 pending execution 的 commit authority。
- [ ] dispose 後的 candidate 不可寫入 observable state。
- [ ] dispose 是 idempotent。

下列項目要等 operational error precedence 定案後才進入 red–green：

- [ ] 決定 current revision execution failure 是否立即 reject `settle(revision)`。
- [ ] 決定 execution failure 與 receive N+1 競爭時的 precedence。
- [ ] 決定 dispose 與已 settled/superseded settlement operation 的互動。

## Phase 8：snapshot 與 restore

- [ ] settled observable state 可以 snapshot 並 restore。
- [ ] snapshot 不包含 live Promise、AbortController 或 execution object。
- [ ] snapshot 時 pending 的 required work，在 restore 後重建為 unsatisfied obligation。
- [ ] restore 不自行啟動 application execution。
- [ ] restore 前 execution 的 late candidate 不能 commit 到 restored instance。
- [ ] 由同一 snapshot restore 的兩個 instances 完全隔離。
- [ ] 不相容 definition/schema 的 snapshot 被拒絕。
- [ ] restored reusable result 不產生不必要的 recomputation obligation。
- [ ] deterministic ID/clock 在 restore 後仍符合 replay host 的要求。

## Phase 9：trace 與 inspection

- [ ] trace 能回答 candidate 的 execution identity 與 causal revision。
- [ ] trace 區分 `completed`、`committed` 與 `rejected`。
- [ ] trace 區分 execution supersession 與 settlement-operation supersession。
- [ ] trace 區分 `cancelled` 與 `superseded`。
- [ ] trace 能說明 invalidation、reuse 與 recomputation 的原因。
- [ ] trace ordering 在 injectable clock/ID 下可重現。
- [ ] inspection 不提供繞過 atomic commit 的修改能力。
- [ ] trace listener 的 reentrancy 不會破壞 validation-and-commit atomicity。

Trace taxonomy 尚未凍結，因此先測必要語義資訊，不提前鎖死所有 event 名稱。

## Phase 10：host interoperability

- [ ] 建立 plain-async changing-input reference example。
- [ ] 將 `reactive-correction-graph` 遷移至 Settle，維持既有 regression baseline。
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
- 檢查 terminology 是否符合 `CONTEXT.md`。
- 完成 review 後才進行結構性 refactor，並以既有 black-box suite 保護行為。

## 明確暫緩的測試

以下語義仍在 RFC 中標為 deferred，不應在未決定前用測試意外固定：

- execution-association 與 candidate-submission 的最終方法名稱及資料形狀。
- causal revision 的具體表示方式。
- required-obligation declaration 的最終 interface。
- supersession 後 `emit()` 的完整語義。
- operational error、dispose 與 supersession 的 precedence。
- 完整 trace taxonomy。
- `/testing` public subpath。
- 特定 host adapter package。

