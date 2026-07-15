# Git 子模块的管理

## 项目背景

当前队里使用的 PYRo 库是以子模块的形式参与到 PYRo-Robot 仓库中的，这样做的主要好处是版本隔离

举个例子：这里有一份基于 PYRo v1.0.0 开发的代码，如果不用子模块，那么当 PYRo 库更新到 v2.0.0，函数接口有所变动时原来的代码可能就直接无法通过编译了，只有完全更新完才能用

但是如果使用了子模块，就可以自己选择是否更新 PYRo 库，从而在队内库更新的时候不用立刻大改自己的代码

## 使用教程

### 文件配置

将 PYRo 代码库的仓库 fork 成为自己的个人仓库

在项目目录中新建文件`.gitmodules`

```
[submodule "PYRo"]
	path = PYRo
	url = https://github.com/Pason666/PYRo_main_repository.git

```

这里的 url 填上述 fork 下来的个人仓库地址即可

### 命令配置

在项目根目录打开终端，输入以下命令：`git submodule update --init`

<script setup>
import { VPTeamMembers } from 'vitepress/theme'
import { mem4 } from '../../public/member_list/members'

const author = [
  mem4,
]
</script>
Author
---
<VPTeamMembers size="small" :members="author" />