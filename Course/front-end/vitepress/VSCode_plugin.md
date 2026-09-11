# VScode文档站开发教程

Lucky看了说太难了学不会🤣，但是相信聪明的你一定能成功配置好环境进行文档站的编写🥰

## 准备活动

### 🏠️创建一个属于自己的仓库

我们的文档站是部署在GitHub上的，这里是[仓库源码的网址](https://github.com/PeiYangRobot/PeiyangRobot.github.io)，如果每个人都直接在这里进行更改，管理整个文档站就会变得极为困难，同时提交时的冲突也会变得非常多，令人非常难受

好在GitHub考虑到了这个情况，推出了非常方便的Fork功能，如下图红框中所示：
![VSCode_plugin-2026-09-07-2026-09-07-20-10-29](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-20-10-29.png)

点击后再点击`Create a new fork`即可在自己的账号下创建一个与这个仓库完全一样的仓库，原来的仓库被称为上游仓库，自己的仓库被称为下游仓库
![VSCode_plugin-2026-09-07-2026-09-07-20-13-06](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-20-13-06.png)
::: warning
这里的`Copy the main branch only`一般需要取消勾选，但是我们这个仓库只有`main`分支，如果选了问题也不大
:::

自己的仓库应该长下面这个样子，注意左上角的归属已经从刚才的组织名称改成了你的账号名称，下面的红框中`This branch is 2 commits ahead of PeiYangRobot/PeiyangRobot.github.io:main.`表示你写的比上游仓库要多，如果组织仓库接受了别人的PR，这里就会显示你比上游仓库落后了几个分支，这个时候需要点击`Sync Fork`更新自己的仓库，然后需要在VSCode中拉取，有冲突请在本地解决

::: tip
PR是Pull requests的简写。交PR类似交作业，交上去之后上游仓库的管理者能看到，并且可以选择是否合并更改
:::

![VSCode_plugin-2026-09-07-2026-09-07-20-16-23](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-20-16-23.png)

至此，你就有了写文档站最基本的东西——一个属于自己的文档站仓库

### 📤️提交自己的更改

当你写完了一篇文档，想要交给上游仓库，在网页上看看自己的杰作，应该怎么做呢，这个时候就需要用到PR了

::: danger
在提交PR之前请一定确保自己的仓库完全超前于上游仓库，否则管理员将不会通过此次PR
:::

![VSCode_plugin-2026-09-07-2026-09-07-20-27-57](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-20-27-57.png)
请点击红框标注的`Pull requests`进入PR界面，然后点击`create a pull request`打开如下界面
![VSCode_plugin-2026-09-07-2026-09-07-20-31-58](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-20-31-58.png)
::: warning
在绿色对勾这里请再次检查是否允许合并
:::

以上内容都检查过后，就可以点击`create pull request`创建提交请求了
![VSCode_plugin-2026-09-07-2026-09-07-20-36-47](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-20-36-47.png)

这里的`title`是必填项，请写是谁提交了更改，大概改了什么内容，如果内容较多，可以在下面的`description`处继续写

填写完成后选择`create pull request`就成功提交了自己的更改了，然后你需要提醒一下管理员通过PR

~~这一块其实整合到插件中了，到时候在VSCode中点一下就直接到写title和description这一步了~~

## 环境搭建

### 🛠️插件获取

请在VSCode的插件商店中搜索`VitePress PR Helper`，如下图
![VSCode_plugin-2026-09-07-2026-09-07-14-59-22](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-14-59-22.png)

从商店安装的好处是可以跟随更新，不用总是从qq群里面下载 ~~（这样看起来更帅一点，还有记得给我好评）~~

安装好插件之后把VSCode重新启动一下，或者 <kbd>CTRL</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> 然后搜索`Developer:Reload Window`，重新加载后插件就会生效，右下角应该会有一个弹窗，如下图
![VSCode_plugin-2026-09-07-2026-09-07-15-09-33](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-15-09-33.png)

### 插件引导

点击`立即检查`，插件就会检查你的电脑中的开发环境是否完整，如果不完整可以点击修复，插件会引导安装所需要的应用，以下是开发所需要的所有环境
![VSCode_plugin-2026-09-07-2026-09-07-17-02-38](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-17-02-38.png)

::: tip
1. 如果检查出`Node.js`装了，但是`npm`没有安装，那可以先尝试提示中的`nvm`指令，如果也没有，建议把`Node.js`删除，让插件引导安装

2. 安装`GitHub CLI`等部分程序时是通过`winget`指令实现的，这个在没有配置过的powershell终端中无法正常使用，如果出现相关报错可以在`VSCode`的终端中输入`cmd`，按下回车后就会切换到cmd终端，然后重新点击修复即可正常安装

3. `PicGo`安装好后需要先在应用中配置，然后才能在VSCode中让插件自动获取配置，具体方法在下面章节

4. 上游仓库请填写`PeiYangRobot/PeiyangRobot.github.io`
:::

::: danger
安装`node.js`时请将安装提示中的所有额外项目勾选上（或者如果看得懂英文请务必勾选`add to PATH`和`安装nvm`）
                    
                                                                            ——卢相泽
::: 

### PicGo配置

打开下载好的PicGo，刚安装好的应该是英文，不过大概也能看懂吧 ~~（Lucky除外了，可能是这里难住他了吧）~~ ，点击图床设置，选中`腾讯云COS`
![VSCode_plugin-2026-09-07-2026-09-07-20-56-38](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/undefinedVSCode_plugin-2026-09-07-2026-09-07-20-56-38.png)

点击加号，图床配置名自己随便写一个，COS版本选V5，SecretId、SecretKey、Bucket、AppId请找队长项管电控组长或者机械组长要，存储区域写`ap-beijing`，剩下的都不需要写，翻到下面点确定就行了
![VSCode_plugin-2026-09-07-2026-09-07-20-58-44](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/undefinedVSCode_plugin-2026-09-07-2026-09-07-20-58-44.png)

配置好了后请重新打开VSCode，从而让插件更新刚才写入的这些配置

至此插件的环境配置就全部完成了，下面是使用教学

## 享受插件带来的便利吧

### 🔪小试牛刀

最基础的功能自然是新建文档并且进行编写了，刚打开的时候应该如下图所示，将上面的红框折叠起来，基础的文档编写只需要使用下面的`Dcumentation`
![VSCode_plugin-2026-09-07-2026-09-07-21-10-46](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/undefinedVSCode_plugin-2026-09-07-2026-09-07-21-10-46.png)

其中红框代表在当前选中的目录下新建一个文档（比如下图中就是在`front-end`文件夹下新建，和`vitepress`文件夹同级）

黄绿色框表示新建文件夹，也是在当前的选中目录下创建
![VSCode_plugin-2026-09-07-2026-09-07-21-14-23](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-14-23.png)

点击了创建文件后会弹出如下提示：
![VSCode_plugin-2026-09-07-2026-09-07-21-17-24](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-17-24.png)
上面这个名字是文件名，必须以`.md`结尾，在网站上不会有任何体现，但是也请取有意义的名字

下面这个名字是文档名，会在网页上直接显示，同时会成为新建出文档的一级标题，请认真斟酌
![VSCode_plugin-2026-09-07-2026-09-07-21-19-08](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-19-08.png)


![VSCode_plugin-2026-09-07-2026-09-07-21-21-17](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-21-17.png)

如果要修改文档名，请打开上图文件，找到写错的文档名进行修改，文档中修改的是文档中的名字，在这里才能修改在目录中的名字，即下图中两个红框的名字其实可以不一样，但是最好不要这样做

![VSCode_plugin-2026-09-07-2026-09-07-21-23-17](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-23-17.png)

在md文档的右上角会出现一排按钮，请将鼠标悬浮在上面并且选择`VitePress:Open Preview`
![VSCode_plugin-2026-09-07-2026-09-07-21-28-23](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-28-23.png)

如果一切正常，等待一会便可以看见当前页面在网页上的预览了，大概是下面这样：
![VSCode_plugin-2026-09-07-2026-09-07-21-30-03](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-30-03.png)
其中左侧的目录都是可以点击的，点击后编辑器页面也会随之跳转

由于图片对齐问题，现在的渲染效果是在编辑页面滚动网络页面不跟随，在网络页面滚动编辑页面跟随，暂时没有找到解决办法

现在，你可以开始编写文档了！

::: tip
输入`/`可以呼出md语法联想，让不熟悉md语法的人也可以编写文档，效果如下：
![VSCode_plugin-2026-09-07-2026-09-07-21-35-18](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-35-18.png)

如果想输入`/`请在弹出菜单后按`ESC`键关闭联想。另外，这个功能在`/`位于句中时不生效，如果需要在句中插入语法请先打空格再打`/`
:::

请在结尾打`/`呼出联想，插入作者卡片，方便大家有问题找你问

::: tip
想要添加姓名请在下图文件中仿照以前的格式进行编写，写完后才能在作者卡片中找到自己
![VSCode_plugin-2026-09-07-2026-09-07-22-19-18](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-22-19-18.png)
:::

### 图片上传

正常来说在不同的文件夹下写文档插入图片时，需要在PicGo中更改路径，但是插件会自动更改，所以你只需要将图片复制到剪贴板，然后按下 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>u</kbd>就能粘贴到文档中

如果想删除图片，需要整体框选链接，右键选择红框内容，然后 <kbd>backspace</kbd> 删除链接
![VSCode_plugin-2026-09-07-2026-09-07-21-46-44](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-21-46-44.png)
::: danger
请务必记住先从云端移除再删除链接，否则图片将迷失在我的云盘中一直占我的位置
:::

### 🔚当尘埃落定

![VSCode_plugin-2026-09-07-2026-09-07-22-11-07](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-22-11-07.png)
写完全部文档后，我推荐在上图处写好commit内容并且提交，然后先点击下图的绿框同步上游仓库（相当于之前说的sync fork），然后点红框，按提示填写相关内容，即可直接提交PR，不再需要打开网页上的GitHub
![VSCode_plugin-2026-09-07-2026-09-07-22-12-48](https://pyro-pic-repository-1351801423.cos.ap-beijing.myqcloud.com/Course/front-end/vitepress/VSCode_plugin-2026-09-07-2026-09-07-22-12-48.png)

然后你就可以跟管理员说一声通过PR，然后在文档站看到自己的大作了

Lucky没学会🐷，你学会了吗？

<Author name="Pason" />
