# 拉取与部署此文档站

## 一、获取此文档站
会使用git的可以跳过此步，自行fork与下载
### 1.1、fork工程

前往[github仓库](https://github.com/PeiYangRobot/PeiyangRobot.github.io)，点击如下所示的fork按钮  
![clone-2026-02-20-20260220224310](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-20-20260220224310.png)  
进入如下所示的页面，  
![clone-2026-02-20-20260220224434](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-20-20260220224434.png)  
按照个人的喜好填写仓库名称与简介，点击fork，建立自己的仓库，由于这个文档站只在主分支上开发，因此其他不需要更改，各位在fork其他项目时，注意选择分支。  

### 1.2、克隆到本地
打开上一步中fork出来的仓库，复制其地址  
![clone-2026-02-20-20260220225918](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-20-20260220225918.png)  
选择自己电脑内的目标存放位置，shift+右键，打开终端  
![clone-2026-02-20-20260220230357](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-20-20260220230357.png)  
在终端内输入
```
git clone https://xxx
```
将网址替换为之前复制的，fork仓库的地址，等待其下载完成。  
![clone-2026-02-20-20260220230626](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-20-20260220230626.png)  
然后在VSCode中打开此文件夹，界面如下所示  
![clone-2026-02-20-20260220230755](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-20-20260220230755.png)  
至此，仓库拉取完毕。  
为了便于开发，在本地新建一个分支，名称随意，后续个人开发均在此分支上进行。  
![clone-2026-02-21-20260221104114](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221104114.png)  
![clone-2026-02-21-20260221104138](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221104138.png)  
并将分支切换到新建的分支上  
![clone-2026-02-21-20260221104311](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221104311.png)
## 二、部署
### 2.1、插件下载
为了方便后续的编写，需要先为VSCode下载如下两个插件  
```
Auto Rename Tag
```
此插件提供html标签的便携更改  
![clone-2026-02-21-20260221085355](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221085355.png)
```
HTML CSS Support
```
此插件提供HTML和CSS的语法高亮与智能提示  
![clone-2026-02-21-20260221085502](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221085502.png)

### 2.2、nodejs下载
#### 2.2.1、NVM下载
nodejs是javascript的运行环境，像phthon一样，其也有许多的发型版本，一些开源的项目需要使用特定的nodejs版本，为了后续开发的方便，这里强烈建议先下载nvm（nodejs的版本管理工具）。  
去到[官网](https://www.nvmnode.com/guide/download.html)，下载最新版本，自行选择去github下载或是到镜像源下载。
![clone-2026-02-21-20260221090352](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221090352.png)  
下载完成后，点开安装软件，自行选择nvm本体的存放位置以及nodejs的存放位置  
![clone-2026-02-21-20260221091035](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221091035.png)  

![clone-2026-02-21-20260221091104](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221091104.png)
安装完成后，在命令行窗口中输入如下指令
```
nvm v
```
![clone-2026-02-21-20260221091224](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221091224.png)  
如返回版本号则说明安装成功
#### 2.2.2、nodejs下载
由于nodejs的服务器在海外，直接下载容易出现卡死的情况，因此需要先配置镜像源，从国内的服务器下载。  
在命令行输入
```
npm config set registry http://registry.npmmirror.com
```
将下载源配置为国内的镜像源  
然后输入
```
npm config get registry
```
检查是否配置成功，如果出现如下提示，则说明配置成功。  
![clone-2026-02-21-20260221093811](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221093811.png)

在命令行输入
```
nvm list available
```
其会打印当前所有nvm的可下载版本，我们选择LTS（long time support）长期支持版本下载  
![clone-2026-02-21-20260221092105](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221092105.png)
输入如下指令，将xx.xx.x替换为自己的目标版本号
```
nvm install xx.xx.x
```  
![clone-2026-02-21-20260221092236](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221092236.png)  
如果在下载较新版本时，其提示如上信息，说明此版本镜像源还未支持，只需要降版本逐渐尝试，找到当前镜像源所支持的版本就行（不能低于vitepress的最低版本要求即18.0） 
我这里选择安装22.22.0版本，等待其下载完成（nodejs有100mb左右，耐心等待其下载完成）  
![clone-2026-02-21-20260221094053](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221094053.png)
出现如上提示即说明下载完成  
输入
```
nvm list
```
此命令会输出当前nvm管理下的所有可用nodejs版本  
![clone-2026-02-21-20260221094156](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221094156.png)  
然后输入
```
nvm use xx.xx.x
```
将xx.xx.x替换为自己下载的版本
![clone-2026-02-21-20260221094326](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221094326.png) 
完成版本切换，此时在命令行输入
```
node -v
```
如果其输出版本号，则说明下载成功  
![clone-2026-02-21-20260221094522](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221094522.png)  
### 2.3、vitepress初始化
回到我们fork的仓库，观察其文件结构，除了
```
.github
.vscode
.vitepress
.gitignore
package-lock.json
package.json
```
外，其他均为文档站内部的markdown文档文件，下面将依次介绍这些文件的作用
1. .github文件夹下的workflows文件夹中存储着一个名为deploy的文件，其是一个github自动化配置脚本，其会在将仓库push至github远程仓库时，自动执行vitepress的编译指令，将静态网站部署至github的服务器，在此项目中一般不需要修改，如果有修改的要求，请参考文章[使用vitepress搭建文档站](./setup.md)![clone-2026-02-21-20260221095824](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221095824.png)
2. .vitepress/theme中存放着vitepress默认主题的css配置与组件配置，config.mts则是此文档站的一些全局外观配置，如何进行这些配置请参考文章[vitepress默认主题配置](./default_theme.md)
3. .vscode/task.json 为VSCode的一个任务配置，便于快捷编译此文档，而不需要手动输入编译命令
4. .gitignore用来指定git忽略的文件  ![clone-2026-02-21-20260221100356](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221100356.png)  
其中node_modules是vitepress所依赖的一些nodejs模块，这些模版稍后可以通过指令一键下载，因此不需要进行跟踪，其他文件则是vitepress在编译过程中产生的一些中间文件。
5. package-lock.json 指定vitepress所依赖的包
6. package.json vitepress编译脚本  

在VSCode的终端中输入如下指令，下载vitepress的包依赖
```
npm add -D vitepress@next
```
![clone-2026-02-21-20260221101039](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221101039.png)  
出现如上提示说明下载成功  
如果终端显示  
![clone-2026-02-21-20260221102136](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221102136.png)  
这是因为微软的powershell不支持脚本，将终端换成cmd即可。  
包依赖下载成功后，可以看见项目中出现如下的文件  
![clone-2026-02-21-20260221102419](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221102419.png)  
下载完成包依赖后，即可进行编译，在本地部署此文档站，有两种方法进行编译  

一、手动在终端输入如下命令
```
npm run docs:dev
```  
有如下输出  
![clone-2026-02-21-20260221102643](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221102643.png)  
ctrl+右键点击此网站，即可在本地浏览器中查看网页效果  
![clone-2026-02-21-20260221102742](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221102742.png)  
二、使用VSCode的task功能  
ctrl+shift+p 打开VSCode指令面板，输入task，选中运行任务  ![clone-2026-02-21-20260221102909](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221102909.png)  
选择在文件.vscode/task.json中已经写好的任务  
![clone-2026-02-21-20260221103003](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221103003.png)  
出现如下提示  
![clone-2026-02-21-20260221103028](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221103028.png)  
和一中一样，打开网站，查看效果。  
这里更加推荐大家使用方法二，不仅编译更加方便，而且此脚本一直在后台运行，对文档站源码进行更改后，相应的更改会自动反应在网页上，不需要再次进行编译，只需要每次打开项目的时候运行一次此任务即可。

## 三、提交PR
经过上述操作，你可以在本地修改文档站源码并进行编译，并且能在浏览器上查看效果。至此，当你确认你的更改无误后，便可提交PR（Pull Request），将你的本地修改合并至队内的[公有仓库](https://github.com/PeiYangRobot/PeiyangRobot.github.io)中，但为了确保合并可靠，还需要进行一些其他的操作。  

根据1.2中的教程，现在你的本地仓库中应该有两条分支
```
|
|-main
|-dev(在1.2中命名的分支)
```
你所有的更改都应该在dev分支上进行，现在假设我在dev分支上修改了某一文件intro.md，以此为例展示如何进行一次PR。  
### 3.1、将本地的修改提交至github上你fork的仓库中
![clone-2026-02-21-20260221105436](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221105436.png)  
打开Vscode的git页面，暂存自己的更改  
![clone-2026-02-21-20260221105554](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221105554.png)  
可以看见更改已经进入暂存区，在红框所示一栏中输入对此次更改的描述，然后点击提交。  
![clone-2026-02-21-20260221105835](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221105835.png)  
点击发布branch，将本地更改同步至云端  
![clone-2026-02-21-20260221105912](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221105912.png)  
出现如下界面说明更改已经同步至云端仓库  

![clone-2026-02-21-20260221105934](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221105934.png)  
打开自己的github仓库，切换到dev分支，确认已经修改  
![clone-2026-02-21-20260221110208](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221110208.png)  
### 3.2、更新公有仓库
由于这个文档站是由队内成员共同开发，可能在你开发的过程中已经有其他队员提交了pr，修改了文档站源码，为了避免冲突，需要在提交pr前先更新源码，将冲突在本地解决。  
在github中，将分支切换到main分支，点击sync fork，更新fork下来的仓库  
![clone-2026-02-21-20260221110648](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221110648.png)  
回到VSCode，将分支切换为main分支  
![clone-2026-02-21-20260221110933](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221110933.png)  
可以看见远程的main分支已经发生更改，点击同步更改将其同步至本地  
![clone-2026-02-21-20260221111322](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221111322.png)  
如果更新远程分支后，在本地看不见更改，可能是因为本地git更新不及时导致的，输入以下命令，将远程分支下载至本地
```
git fetch origin
```
将远程分支同步至本地后，效果如下
![clone-2026-02-21-20260221111526](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221111526.png)

### 3.3、合并分支
将分支切回dev分支  
![clone-2026-02-21-20260221111618](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221111618.png)  
选择合并分支  
![clone-2026-02-21-20260221111728](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221111728.png)
如果有冲突，参考[此文章](https://vscode.js.cn/docs/sourcecontrol/merge-conflicts)合并冲突，合并完冲突后，同[3.1](#31将本地的修改提交至github上你fork的仓库中)更新仓库并同步至github上  
![clone-2026-02-21-20260221112318](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221112318.png)
### 3.4、提交PR
在github的仓库中，切到dev分支，点击Compare & pull request  
![clone-2026-02-21-20260221112528](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221112528.png)  
进入如下界面，确认自己是否是从fork仓库的dev分支合并至主仓库的main分支  
![clone-2026-02-21-20260221112730](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221112730.png)  
为了方便管理，务必为你的提交添加必要的信息，在add a title一栏中输入的信息，与git commit一样，会被记录进git仓库中，而add a description可以为你自己的修改添加更加详细的描述，方便pr的审核。
![clone-2026-02-21-20260221112923](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221112923.png)  
一些开源的项目的pr对add a title有严格的格式要求，对于此文档站而言，各位在开发过程中主要是编写markdown文件，因此，我们的pr格式为
```
文件1路径 编写内容1
文件2路径 编写内容2
......
```
以我此次提交的pr为例，我修改了位于Courese/front-end/intro.md，文章名称为《简介》，那么我的title就是
```
Course/front-end/intro.md 修改《简介》
```
提交完pr后，会进入如下界面  
![clone-2026-02-21-20260221113439](https://peiyangrobot-doc-1405234710.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/clone-2026-02-21-20260221113439.png)  
需要等待审核通过才能正式合并进文档站，如果是队内开发，当你提交pr后，请及时提醒队内负责维护此文档站的队员，对你的pr进行审核。

<script setup>
import { VPTeamMembers } from 'vitepress/theme'

import { 
  mem1, 
} from '../../../public/member_list/members'
</script>
Author
--- 
<VPTeamMembers size="small" :members="[mem1]" />
