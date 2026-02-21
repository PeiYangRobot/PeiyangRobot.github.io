import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "PYRo",
  description: "天津大学北洋机甲文档站",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    siteTitle: "PeiYang Robot",    
    logo: '/figure/校徽.png',
    nav: [

      { text: '嵌入式框架', link: '/PYRo-uCtrl-Unity/index' },
      { text: '新生培训', 
        items: [
          { text: '电控培训', link: '' },
          { text: '机械培训', link: '' },
          { text: '硬件培训', link: '' },
          { text: '算法培训', link: '' },
          { text: '通识培训', link: '' },
          { text: 'RM培训', link: '' },
        ]
      },
      { text: '教程', 
        items: [
          { text: '导航栏', link: '/Course/intro' },
          { text: '嵌入式框架教程', link: '/Course/PYRo-uCtrl-Unity/intro' },
          { text: '前端教程', link: '/Course/front-end/intro' },
          { text: '其他教程', link: '/Course/others/intro' },
        ]
      },
      { text: '队史馆', link: '/' },
      
    ],

//右侧侧边栏配置
 sidebar: {
  //嵌入式框架侧边栏
      '/PYRo-uCtrl-Unity': [
        {
          text: 'PYRo-uCtrl-Unity',
          items: [
            { text: '简介', link: '/PYRo-uCtrl-Unity/index' },
            { text: 'Algorithm', collapsed: true, items: [
              { text: '简介', link: '/PYRo-uCtrl-Unity/Algorithm/index' },
              { text: 'common', link: '/PYRo-uCtrl-Unity/Algorithm/common' },
            ] },
            { text: 'Application', collapsed: true, items: [
              { text: '简介', link: '/PYRo-uCtrl-Unity/Application/index' },
            ] },
            { text: 'Component', collapsed: true, items: [
              { text: '简介', link: '/PYRo-uCtrl-Unity/Component/index' },
            ] },
            { text: 'Core', collapsed: true, items: [
              { text: '简介', link: '/PYRo-uCtrl-Unity/Core/index' },
            ] },
            { text: 'Debug', collapsed: true, items: [
              { text: '简介', link: '/PYRo-uCtrl-Unity/Debug/index' },
            ] },
            { text: 'Device', collapsed: true, items: [
              { text: '简介', link: '/PYRo-uCtrl-Unity/Device/index' },
            ] },
            { text: 'Module', collapsed: true, items: [
              { text: '简介', link: '/PYRo-uCtrl-Unity/Module/index' },
            ] },
            { text: 'Peripheral', collapsed: true, items: [
              { text: '简介', link: '/PYRo-uCtrl-Unity/Peripheral/index' },
            ] },
          ]
        }
      ],
      //教程侧边栏
      //教程-前端
      '/Course/front-end': [
        {text: '返回', link: '/Course/index'},
        {text: '简介', link: '/Course/front-end/intro'},
        {text: 'vitepress',collapsed: true, items: [
          {text: '使用vitepress搭建文档站', link: '/Course/front-end/vitepress/setup'},
          {text: '拉取与部署', link: '/Course/front-end/vitepress/clone'},
          {text: '编写Markdown文档', link: '/Course/front-end/vitepress/markdown'},
          {text: 'vitepress默认主题配置', link: '/Course/front-end/vitepress/default_theme'},
        ]},
      ],
      //教程-其他
      '/Course/others': [
        {text: '返回', link: '/Course/index'},
        {text: '简介', link: '/Course/others/intro'},
        {text: 'VSCode配置图床', link: '/Course/others/VSCode_imgbed_cfg'},

        ]
    },

    outline: {
      level: [2, 3], // 显示 h2 到 h3 的标题
      label: '目录',  // 右侧栏顶部的标题文字
      
      
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/PeiYangRobot' },
      { icon: 'bilibili', link: 'https://space.bilibili.com/520634089?spm_id_from=333.337.0.0' },
      { icon: 'dji', link:'https://www.robomaster.com/zh-CN'}
    ],
    footer: {
      copyright: 'Copyright © 2026 - prsent PeiYang Robot'
    },
    search: {
      provider: 'local'
    },
  }
})

  

