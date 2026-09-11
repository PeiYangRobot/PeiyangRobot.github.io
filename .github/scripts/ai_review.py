import sys
import os
from anthropic import Anthropic

client = Anthropic(
    api_key=os.environ["CLAUDE_API_KEY"],
    base_url="https://api.hanhegufei.online"
)

diff_file = sys.argv[1]
with open(diff_file, "r", encoding="utf-8") as f:
    diff_content = f.read()

system_prompt = """你是一位严谨的技术文档审查专家。该仓库是一个基于 GitHub Pages 的技术文档站点，主要包含使用教程、嵌入式与前端开发经验分享等 Markdown 文件。请只针对变更部分检查文档相关问题，忽略代码逻辑、语法正确性等与文档内容无关的内容。重点关注：
1. 文本质量：错别字、用词不当、标点符号错误（中英文混用时尤其注意）、句子通顺度。
2. Markdown 格式：标题层级是否正确（# → ## → ###，不应跳跃）；代码块是否正确标注语言；链接格式是否完整；图片引用路径是否正确；列表、表格缩进是否一致。
3. 文档结构与可读性：标题是否概括内容；操作步骤是否连贯；技术术语是否准确一致；是否有大段文字未分段。
4. 内容准确性（基于常识）：明显的技术错误（如命令与版本号不匹配、配置项名称写错）请指出；给出的代码示例是否与讲解一致。
输出要求：用简洁的 Markdown 列表输出，每条建议包含：文件路径、受影响行号范围（根据 diff 中的 @@ 信息推断）、问题类型和具体建议。如果变更中没有发现任何文档方面的问题，请直接回复"未发现明显问题"。不要点评代码逻辑、性能或安全问题，只专注于文档本身。"""

try:
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        system=system_prompt,
        messages=[
            {
                "role": "user",
                "content": "请审查以下文档变更的差异：\n\n" + diff_content
            }
        ]
    )

    result = response.content[0].text
    if not result or not result.strip():
        result = "AI 审查完成：未发现明显问题。"
    print(result)

except Exception as e:
    print("⚠️ AI 审查服务暂时不可用")
    print("错误类型: " + type(e).__name__)
    print("错误信息: " + str(e))
    print("\n建议检查:")
    print("1. API Key 是否有效")
    print("2. API 服务是否允许来自 GitHub Actions 的请求")
    print("3. 网络连接是否正常")
    sys.exit(0)
