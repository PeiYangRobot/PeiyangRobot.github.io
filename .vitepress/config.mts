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
      { text: '教程', link: '/Course/index' },
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
      //教程-其他
      '/Course/others': [
        {text: '简介', link: '/Course/others/index'},
        {text: 'VSCode配置图床', link: '/Course/others/VScode图床配置'},

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

  

