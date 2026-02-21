# Vitepress中的Markdown
vitepress中的markdown语法与标准语法基本相同，这里不过多赘述，如果有不了解markdown语法的，请自行了解。  

而一些特殊的功能，可以参考[官方文档](https://vitepress.dev/zh/guide/markdown)  

这里着重讲一些需要注意的点
## 一、编辑器
由于此文档站的图片采取[上传至图床](../../others/VSCode_imgbed_cfg.md)的方式进行存储，因此不建议各位使用诸如obsidian，Typora等其他markdown编辑器进行编辑。通过安装插件Markdown All in One即可实现在VSCode内编辑md文件。  
![markdown-2026-02-22-20260222050013](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/markdown-2026-02-22-20260222050013.png)  
下载完成后，通过如下的快捷键可以实现markdown文件的预览  
![markdown-2026-02-22-20260222050239](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/markdown-2026-02-22-20260222050239.png)  
如果快捷键不起效果，请自行检查是否有其他的插件与此快捷键冲突，或者是使用VSCode命令的方式进行预览  
![markdown-2026-02-22-20260222050357](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/markdown-2026-02-22-20260222050357.png)  

## 二、文件中需要注意的地方
### 2.1、CommonMark规范
CommonMark是一个统一的Markdown文件编写规范，大部分开源项目网站的markdown文件渲染均遵循此规范，包括github，Markdown All in One，vitepress等。但其大部分均与标准Markdown语法相同，需要注意的不同点在于：  
1. 单独的回车不会被渲染为换行，需要在文章末尾添加两个空格+回车才能实现换行。
2. 和中文文章不同，段落开头没有缩进，段落与段落之间用空行隔开。
### 2.2、vitepress渲染注意事项
1. vitepress是将markdown文件编译为html文件，进而部署在网站上的，而生成url链接时，使用的是md文件的文件名。因此，如果使用中文文件名，在网站上将无法找到相应的文件，进而报404（可以通过配置编码的方式以使用中文文件名，但这样生成的url链接将会是一段难以读懂的代码，为了可读性，统一使用英文文件名）。
2. 与市面上常用的markdown编译器不同，在默认的vitepress主题下，不支持将md的文件名作为文章的标题，而是使用一级标题作为文章的标题（即# 标题）。
3. 右侧边栏仅显示h2，h3，且不可折叠
### 2.3、数学公式
如果需要编写latex公式，请在命令行输入
```sh
npm add -D markdown-it-mathjax3@^4
```  
将latex的渲染包导入
<script setup>
import { VPTeamMembers } from 'vitepress/theme'

import { 
  mem1, 
} from '../../../public/member_list/members'
</script>
Author
--- 
<VPTeamMembers size="small" :members="[mem1]" />
