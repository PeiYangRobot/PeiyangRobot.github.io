# 基于 GitHub Actions 的 AI 自动 PR 审查工具搭建指南

本文档记录了为 GitHub 技术文档仓库搭建 AI 自动 PR 审查工具的完整过程。当仓库收到 Pull Request（包括来自 fork 的 PR 和来自统一仓库不同分支间的 PR）时，自动调用 AI 模型对文档内容进行审查，并将意见以 PR Review 形式反馈给提交者。

## 基础版

### 1. 项目背景与目标

**仓库类型**：基于 GitHub Pages 的技术文档站点，内容为 Markdown 格式的使用教程和开发经验分享。

**审查重点**：
- 文本质量（错别字、用词、标点、通顺度）
- Markdown 格式（标题层级、代码块标注、链接、图片引用）
- 文档结构（标题概括性、步骤连贯性、术语准确性）
- 内容准确性（明显技术错误、代码示例与讲解一致性）

**技术选型**：
- GitHub Actions（自动化）
- Python + OpenAI SDK（兼容多模型）
- DeepSeek / Gemini 等大语言模型
- `pull_request_target` 事件（安全支持 fork PR 的密钥访问）

### 2. 最终工作流文件

配置完成后，你的项目根目录下应多一个 .github 文件夹：

```md
.
└── .github
  ├── scripts
  │ ├── ai_review.py
  │ └── requirements.txt
  └── workflows
    └── ai-review.yml
```

#### 2.1 工作流定义（.github/workflows/ai-review.yml）

```yaml
# 工作流名称：会在 Actions 页面显示
name: AI Code Review (DeepSeek)

# 触发条件：监听 PR 事件
on:
  pull_request_target:                     # 使用 pull_request_target 以安全访问仓库 Secrets（支持 fork PR）
    types: [opened, synchronize, reopened] # 触发时机：PR 新建、有新提交、被重新打开

# 工作流运行所需权限
permissions:
  contents: read        # 允许读取仓库内容（用于 checkout 和 gh CLI）
  pull-requests: write  # 允许在 PR 中创建 Review 评论

# 定义具体的执行任务
jobs:
  review:                          # 任务名称
    runs-on: ubuntu-latest         # 运行环境（最新的 Ubuntu 虚拟机）
    steps:
      # 步骤 1：安全检出目标分支中受信任的脚本（不检出 PR 分支代码，防止恶意代码执行）
      - name: Checkout trusted scripts
        uses: actions/checkout@v4
        with:
          ref: ${{ github.base_ref }}   # 只检出 PR 的目标分支（如 main）
          path: trusted                 # 将代码放在 trusted 目录下，便于后续引用

      # 步骤 2：获取 PR 的全部 diff（包含所有变更文件）
      - name: Get PR diff
        id: diff                                  # 步骤 id，供后续引用
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}   # GitHub 内置 Token，用于 gh CLI 鉴权
        run: |
          PR_NUMBER=${{ github.event.pull_request.number }}
          # 获取 PR 的 diff（只读操作，安全）
          gh pr diff $PR_NUMBER --repo ${{ github.repository }} > pr.diff  
          # 记录 diff 大小，可用于调试或后续判断
          echo "diff_length=$(wc -c < pr.diff)" >> $GITHUB_OUTPUT

      # 步骤 3：安装 Python 依赖
      - name: Install Python dependencies
        run: pip install -r trusted/.github/scripts/requirements.txt

      # 步骤 4：调用 DeepSeek 审查脚本分析 diff
      - name: Analyze diff with DeepSeek
        id: analyze
        env:
          AI_API_KEY: ${{ secrets.AI_API_KEY }}  # 从仓库 Secrets 中读取 AI API Key
        run: |AI
          # 执行审查脚本，将 diff 文件作为参数传入，输出结果保存到 review_output.md
          python trusted/.github/scripts/ai_review.py pr.diff > review_output.md
          # 将审查内容以多行形式写入 GITHUB_OUTPUT，供后续步骤使用
          {
            echo 'review_body<<EOF'
            cat review_output.md
            echo EOF
          } >> $GITHUB_OUTPUT

      # 步骤 5：将审查结果作为 PR Review 评论发布
      - name: Post review comment
        if: success()                         # 仅当前面所有步骤成功时才运行
        uses: actions/github-script@v7        # 使用 GitHub 官方脚本 Action（
        env:
          REVIEW_BODY: ${{ steps.analyze.outputs.review_body }}  # 通过环境变量安全传递可能含特殊字符的审查文本
        with:
          script: |
            const reviewBody = process.env.REVIEW_BODY;
            if (reviewBody && reviewBody.trim()) {
              // 创建 PR Review（类型为 COMMENT，不会直接通过或拒绝 PR，也可以进行修改全自动通过拒绝）
              await github.rest.pulls.createReview({
                owner: context.repo.owner,
                repo: context.repo.repo,
                pull_number: context.issue.number,
                body: reviewBody,
                event: 'COMMENT'
              });
            }
```

#### 2.2 依赖文件（.github/scripts/requirements.txt）

```txt
openai>=1.0.0
```

#### 2.3 审查脚本（.github/scripts/ai_review.py）

以下提供 DeepSeek 版本（使用 OpenAI SDK 兼容调用）。

```python
import sys, os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["AI_API_KEY"],  # 这里只是一个名字，保证 .yml，.py 和后续网页中配置的 secrets 名字一致即可
    base_url="https://api.deepseek.com"   # DeepSeek 接口
)

diff_file = sys.argv[1]
with open(diff_file, "r") as f:
    diff_content = f.read()

response = client.chat.completions.create(
    model="deepseek-v4-pro",  # 模型在这里更改
    messages=[
        {
            "role": "system",
            "content": (
                "你是一位严谨的技术文档审查专家。"
                "该仓库是一个基于 GitHub Pages 的技术文档站点，主要包含使用教程、嵌入式与前端开发经验分享等 Markdown 文件。"
                "请只针对变更部分检查文档相关问题，忽略代码逻辑、语法正确性等与文档内容无关的内容。"
                "重点关注："
                "1. 文本质量：错别字、用词不当、标点符号错误（中英文混用时尤其注意）、句子通顺度。"
                "2. Markdown 格式：标题层级是否正确（# → ## → ###，不应跳跃）；代码块是否正确标注语言；链接格式是否完整；图片引用路径是否正确；列表、表格缩进是否一致。"
                "3. 文档结构与可读性：标题是否概括内容；操作步骤是否连贯；技术术语是否准确一致；是否有大段文字未分段。"
                "4. 内容准确性（基于常识）：明显的技术错误（如命令与版本号不匹配、配置项名称写错）请指出；给出的代码示例是否与讲解一致。"
                "输出要求："
                "用简洁的 Markdown 列表输出，每条建议包含：文件路径、受影响行号范围（根据 diff 中的 @@ 信息推断）、问题类型和具体建议。"
                "如果变更中没有发现任何文档方面的问题，请直接回复“未发现明显问题”。"
                "不要点评代码逻辑、性能或安全问题，只专注于文档本身。"
            )
            # 提示词请根据仓库的内容进行更改
        },
        {
            "role": "user",
            "content": f"请审查以下文档变更的差异：\n\n{diff_content}"
        }
    ],
    temperature=0.0,
    max_tokens=2048,
)

# 安全提取内容，防止空输出导致 PR 评论被跳过
result = response.choices[0].message.content
if not result or not result.strip():
    result = "AI 审查完成：未发现明显问题。"
print(result)
```

### 3. 配置与部署

#### 3.1 添加 API 密钥

1. 进入仓库 Settings → Secrets and variables → Actions → Repository secrets。

2. 点击 New repository secret。

3. Name 填入 AI_API_KEY（与工作流中的 env 一致）。

4. Value 粘贴你的 AI 服务密钥（如 DeepSeek 或 Gemini 的 Key）。

5. 确保不要添加在 Environment secrets 中，否则工作流可能读取不到。

着重说一下这里，当时在这里牢了很久，组织的仓库和个人的仓库不同，没有
```
进入仓库 Settings → Actions → General，找到 Fork pull request workflows from outside collaborators 部分，勾选：
☑️ Send secrets to workflows from fork-based pull requests
```

只能通过
```md
使用 pull_request_target 事件。这个事件能让工作流在目标仓库的安全上下文中运行，从而访问到 Secrets，但也必须小心配置以避免安全风险。

**pull_request_target 的工作原理与风险**
它运行在目标仓库（PeiYangRobot/pr_agent_test）的默认分支（如 main）上，所以能读取仓库的 Secrets。

但是，GitHub 会自动 checkout 源分支（fork 分支）的代码，也就是说，如果恶意提交者在 PR 中修改了你的审查脚本或 workflow 文件，理论上可以窃取你的 API 密钥。

所以我们必须做到：绝不 checkout 或执行任何来自 fork 分支的代码，只使用目标分支自带的脚本和配置。

**✅ 安全的 pull_request_target 配置方案**
我们将修改 workflow，使其在 pull_request_target 事件触发时，只从目标仓库检出我们信任的脚本（.github/scripts/ai_review.py），然后获取 PR 的 diff 发送给 DeepSeek。完全不执行 PR 分支中的任何文件。
```

总之现在是可以用了

#### 3.2 推送到仓库

将以下三个文件放在仓库的默认分支（如 main）对应路径下：

- .github/workflows/ai-review.yml

- .github/scripts/requirements.txt

- .github/scripts/ai_review.py

推送后，所有新的 PR（包括 fork PR）都会自动触发审查。

### 4. 常见问题与解决

| 现象 | 原因 | 解决 |
|------|------|------|
| `ModuleNotFoundError: No module named 'openai'` | 未安装依赖 | 在工作流中添加 `pip install -r` 步骤，且 `requirements.txt` 包含 `openai` |
| `No such file or directory: '...ai_review.py'` | 脚本路径拼写错误或未提交 | 检查 `.github/scripts/` 目录下文件是否存在，且拼写正确 |
| 密钥长度为 0（`Debug: Key length is 0`） | 1. Secret 值未正确保存<br>2. 使用了 `pull_request` 事件且 PR 来自 fork<br>3. Secret 设置在 Environment 层级 | 1. 重新添加 Secret<br>2. 改用 `pull_request_target`<br>3. 确认在 Repository secrets 中设置 |
| `SyntaxError` 在 `actions/github-script` 步骤 | 审查结果包含反引号或 `${` 等特殊字符，破坏了 JavaScript 模板字符串 | 改用环境变量传递（如示例中的 `REVIEW_BODY`），并使用 `github-script@v8` |
| 连接超时 `ConnectTimeout` | 使用 OpenAI SDK 但 `base_url` 填了不兼容的地址（如直接写 Gemini 地址） | Gemini 需要使用原生 SDK，DeepSeek 使用 `https://api.deepseek.com` |
| 没有 PR 被审查 | 工作流文件只存在于源分支，未合并到目标分支 | 确保工作流文件在默认分支（如 `main`）中存在 |
| fork PR 没有触发或不报错 | 可能因为仓库 Actions 设置要求对 fork PR 审批，或未启用 “Send secrets” | 检查 Settings → Actions → General 中的 Fork pull request 设置 |

## 拓展版

### 1. 自动通过PR

#### 1. 项目背景与目标

**仓库类型**：存放队里所有机器人代码的仓库。

**需求**：当有 PR 提交时能及时通过，便于代码在兵种组内不同队员直接合作开发

如果是全部交给仓库管理员进行审核的话其实跟没有审核没什么区别，当改动仅发生在兵种组内部时应当允许更改直接被通过（在没有冲突的情况下）

在这种需求下，通过工作流直接通过 PR 的优势就体现出来了

#### 2. 最终工作流文件

相比于基础版，只需要对其中的 .yml 文件进行修改即可，我们想做到的是在发起 AI 审查前先看看改动文件，以下直接给出完整代码


```yaml
name: AI Code Review (DeepSeek)

on:
  pull_request_target:          # 关键：改为 pull_request_target
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    # 不再需要 fork 条件，因为 target 事件始终在目标仓库运行
    steps:
      # ========================
      # 团队豁免检查 + 自动 approve 与 merge
      # ========================
      - name: Team-based auto approve and merge
        id: team_check
        uses: actions/github-script@v8
        env:
          TEAM_RULES: ${{ vars.TEAM_RULES }}   # 从仓库 Variables 读取团队规则
        with:
          script: |
            const rules = JSON.parse(process.env.TEAM_RULES);
            const prAuthor = context.payload.pull_request.user.login;
            const prNumber = context.issue.number;
            const { data: files } = await github.rest.pulls.listFiles({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: prNumber,
              per_page: 100
            });
            const changedPaths = files.map(f => f.filename);
            console.log('PR author:', prAuthor);
            console.log('Changed files:', changedPaths);

            // 1. 查找作者所属兵种
            let authorTeam = null;
            for (const [team, config] of Object.entries(rules)) {
              if (config.members.includes(prAuthor)) {
                authorTeam = team;
                break;
              }
            }

            // 不属于任何豁免兵种 → 正常审查
            if (!authorTeam) {
              console.log('Author not in any team with skip privilege.');
              core.setOutput('auto_merge', 'false');
              return;
            }

            // 2. 检查所有变更是否都在该兵种目录下
            const teamPath = rules[authorTeam].path;
            const allInTeamDir = changedPaths.every(p => p.startsWith(teamPath));
            if (!allInTeamDir) {
              console.log('Changes outside team directory, regular review required.');
              core.setOutput('auto_merge', 'false');
              return;
            }

            // 3. 满足条件：自动 approve
            console.log(`All changes in ${authorTeam} directory. Approving...`);
            await github.rest.pulls.createReview({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: prNumber,
              event: 'APPROVE',
              body: `🤖 自动通过：${prAuthor} 属于 **${authorTeam}** 兵种，且所有改动仅涉及本兵种目录，无需人工审查。`
            });

            // 4. 尝试自动 merge
            try {
              await github.rest.pulls.merge({
                owner: context.repo.owner,
                repo: context.repo.repo,
                pull_number: prNumber,
                merge_method: 'merge'   // 可改为 'squash' 或 'rebase'
              });
              console.log('PR merged successfully.');
              core.setOutput('auto_merge', 'true');
            } catch (mergeError) {
              // 冲突：关闭 PR 并留言
              if (mergeError.status === 409) {
                console.log('Merge conflict. Closing PR...');
                await github.rest.issues.createComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: prNumber,
                  body: '❌ 存在冲突，请解决并重新提交。'
                });
                await github.rest.pulls.update({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  pull_number: prNumber,
                  state: 'closed'
                });
                core.setOutput('auto_merge', 'false');
              } else {
                // 其他错误（如分支保护）仅留言不关闭
                console.log('Auto merge failed:', mergeError.message);
                await github.rest.issues.createComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: prNumber,
                  body: `⚠️ 自动合并失败：${mergeError.message} 请手动合并或检查分支保护规则。`
                });
                core.setOutput('auto_merge', 'false');
              }
            }

      # ========================
      # 以下为常规 AI 审查（仅在未自动 merge 时执行）
      # ========================
      # 第一步：只检出目标分支（main）的代码，而不是 PR 的合并代码
      - name: Checkout trusted scripts
        if: steps.team_check.outputs.auto_merge != 'true'
        uses: actions/checkout@v4
        with:
          ref: ${{ github.base_ref }}   # 强制使用目标分支（如 main）
          path: trusted                 # 放到 trusted 目录下，避免与后续操作混淆

      - name: Get PR diff
        if: steps.team_check.outputs.auto_merge != 'true'
        id: diff
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER=${{ github.event.pull_request.number }}
          # 获取 PR 的 diff（只读操作，安全）
          gh pr diff $PR_NUMBER --repo ${{ github.repository }} > pr.diff
          echo "diff_length=$(wc -c < pr.diff)" >> $GITHUB_OUTPUT

      - name: Install Python dependencies
        if: steps.team_check.outputs.auto_merge != 'true' && steps.diff.outputs.skip_review != 'true'
        run: pip install -r trusted/.github/scripts/requirements.txt

      - name: Analyze diff with DeepSeek
        if: steps.team_check.outputs.auto_merge != 'true' && steps.diff.outputs.skip_review != 'true'
        id: analyze
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
        run: |
          # 使用我们信任的脚本（来自目标分支）
          python trusted/.github/scripts/ai_review.py pr.diff > review_output.md
          # 保底输出，防止模型返回空导致无评论
          if [ ! -s review_output.md ]; then
            echo "AI 审查完成：未发现明显问题。" > review_output.md
          fi
          {
            echo 'review_body<<EOF'
            cat review_output.md
            echo EOF
          } >> $GITHUB_OUTPUT

      - name: Post review comment
        if: steps.team_check.outputs.auto_merge != 'true' && steps.diff.outputs.skip_review != 'true' && success()
        uses: actions/github-script@v8
        env:
          REVIEW_BODY: ${{ steps.analyze.outputs.review_body }}   # 用环境变量传递
        with:
          script: |
            const reviewBody = process.env.REVIEW_BODY;
            if (reviewBody && reviewBody.trim()) {
              await github.rest.pulls.createReview({
                owner: context.repo.owner,
                repo: context.repo.repo,
                pull_number: context.issue.number,
                body: reviewBody,
                event: 'COMMENT'
              });
            }
```

### 3. 配置与部署

首先是基础版的密钥，然后需要在 GitHub 上勾选`Allow GitHub Actions to create and approve pull requests`，具体位置是在 `https://github.com/组织名称/仓库名称/settings/actions`的最下面，如果是灰色的不让点击，请找组织管理员在`https://github.com/organizations/组织名称/settings/actions`的最下面启用该功能，打开这个是为了让 Actions 提供的 Approve 能 merge PR

最后请在添加密钥的同一页面找到`Variables`，添加新的 Repository variables，名称填 TEAM_RULES，Value 为 json 格式，示例如下：

``` json
{
  "Infantry": {
    "path": "Robot/Infantry/",
    "members": ["aaa"]
  },
 "Hero": {
    "path": "Robot/Hero/",
    "members": ["bbb"]
  }
}
```

注意这里的 members 要填写用户名而非昵称，path 要填写从根目录开始的完整路径。