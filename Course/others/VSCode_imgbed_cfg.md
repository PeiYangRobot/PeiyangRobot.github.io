

# VSCode图床配置

## 一、什么是图床
图床，指图片存储和托管服务，当我们将一张图片上传至图床时，其会将图片存储至图床的本地服务器，并且生成一个网络连接，互联网上的其他人可以通过此链接来访问这张图片。

## 二、为什么要将图片上传至图床
1. 对于此文档站来说，其依托于github官方的静态托管服务，存储容量有限。使用图床存储的话，由于图片实际存储在图床服务商的服务器内，此仓库仅需存储链接，实际内存大大减小，其他人拉取仓库也更加简单。
2. 如果将其存储在本地，由于要使用相对存储路径，在markdown文档内嵌入图片将会十分繁琐。通过VSCode中的插件，可以以快捷键的方式将剪切板中的图片插入markdown文件中，而不需要将图片放入仓库，再手动输入相对路径。

## 三、配置图床
### 3.1、配置picgo
picgo是一个图片上传工具，自行在[下载链接](https://github.com/Molunerfinn/PicGo/releases/tag/v2.5.2)下载。  

下载完成后![VSCode_imgbed_cfg-2026-02-20-20260220100213](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220100213.png)
打开图床设置，选择你所使用的图床（队里现在用的是腾讯云），新建图床，进入如下页面。
![VSCode_imgbed_cfg-2026-02-20-20260220201808](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220201808.png)
这些选项中，前面有红色*提示的为必填项。其中图床配置名随意，cos版本选择v5，其余选项为图床相关设置，参考章节3.2中的教程配置图床。（如果是队内开发，找本赛季的队项要本队的图床key）  

![VSCode_imgbed_cfg-2026-02-20-20260220202153](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220202153.png)
在这些没有*标识的可选项中，没有特殊要求不需要进行配置，但需要注意的是，如果是为本文档站编写文档，<font color="red">请将设定存储路径一栏设置为你正在编写的文档处于此仓库的路径，注意要以"/"结尾</font>，以便于图床的管理，如这篇文章所处在Course/others下，那么此时我的图床路径配置为
![VSCode_imgbed_cfg-2026-02-20-20260220202826](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220202826.png)
生成的图片路径也有相应的体现，如下所示![VSCode_imgbed_cfg-2026-02-20-20260220202941](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220202941.png)，此时在腾讯云中，会在相应的文件夹中存储图片![VSCode_imgbed_cfg-2026-02-20-20260220203202](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220203202.png)以便于后续的管理，各位队员在编写文档时，一定要注意自己的图片路径是否设置正确，如果路径不正确，在最后的pr审核中不会通过。为了方便，各位可以多设置几个图床，只改变存储路径，在编写不同文档的时候进行切换。

### 3.2、配置腾讯云
参考[官方文档](https://cloud.tencent.com/document/product/436/74373)自行配置（队内队员找在职队项要），此处不过多赘述。

### 3.3、配置VSCode插件
![VSCode_imgbed_cfg-2026-02-20-20260220203745](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220203745.png)
在VSCode的拓展商店中下载Picgo的官方插件，根据自己的系统，找到data.json这个文件的路径，各系统文件路径参考下图![VSCode_imgbed_cfg-2026-02-20-20260220203933](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220203933.png)
找到此路径后，将其粘贴至Picgo插件设置项中的Config path与data path中![VSCode_imgbed_cfg-2026-02-20-20260220204043](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220204043.png)![VSCode_imgbed_cfg-2026-02-20-20260220204112](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220204112.png)，这个文件存储着章节3.1中的配置向，这一步相当于将Picgo软件中的配置项同步至插件中。  

配置完路径后，在将Custom Upload Name这一项改为如下所示![VSCode_imgbed_cfg-2026-02-20-20260220204400](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220204400.png)
```
${mdFileName}-${date}-${fileName}${extName}
```
相较默认设置，其增加了mdFileName和date，可以显示此张图片所处的md文件以及上传时间，方便后续管理，效果如下图所示![VSCode_imgbed_cfg-2026-02-20-20260220204621](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220204621.png)

## 四、使用
配置完上述文件后，将所需插入的图片复制进剪切板，按Ctrl+alt+u会将剪切板中的文件以链接的形式插入光标所在处![VSCode_imgbed_cfg-2026-02-20-20260220204847](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/others/VSCode_imgbed_cfg-2026-02-20-20260220204847.png)且右下角会有如上所示的插入成功提示，此时在markdown预览中也可以看见相应的图片。  

需要注意的是，当前此插件只能进行上传，不能想软件本体一样，对上传至图床的文件进行修改。所以，如果在编辑过程中，传错了图片，请联系图床的管理员进行删除，以避免产生不必要的开销。
<script setup>
import { VPTeamMembers } from 'vitepress/theme'

import { 
  mem1, 
} from '../../public/member_list/members'
</script>
Author
--- 
<VPTeamMembers size="small" :members="[mem1]" />
