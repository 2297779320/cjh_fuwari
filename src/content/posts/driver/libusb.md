---
title: libusb 驱动X应用
published: 2025-12-16
description: ''
image: 'https://www.loliapi.com/bg/'
tags: [应用]
category: '软件开发'
draft: false 
lang: 'zh-CN'
---

## 前言

libusb 设计了一系列的外部API 为应用程序所调用，通过这些API应用程序可以操作硬件，从libusb的源代码可以看出，这些API 调用了内核的底层接口，和kernel driver中所用到的函数所实现的功能差不多，只是libusb更加接近USB 规范。使得libusb的使用也比开发内核驱动相对容易的多。


## 应用


初始化设备接口

```yaml
void usb_init(void);
```
从函数名称可以看出这个函数是用来初始化相关数据的，这个函数大家只要记住必须调用就行了，而且是一开始就要调用的.

 
```yaml
 int usb_find_busses(void);
```

寻找系统上的usb总线，任何usb设备都通过usb总线和计算机总线通信。进而和其他设备通信。此函数返回总线数。

 

usb_find_devices

```yaml
 int usb_find_devices(void);
```

寻找总线上的usb设备，这个函数必要在调用usb_find_busses()后使用。以上的三个函数都是一开始就要用到的，此函数返回设备数量。

 

usb_get_busses

```yaml
struct usb_bus *usb_get_busses(void);
```

这个函数返回总线的列表，在高一些的版本中已经用不到了，这在下面的实例中会有讲解

 
usb_open

```yaml
usb_dev_handle *usb_open(struct *usb_device dev);
```

打开要使用的设备，在对硬件进行操作前必须要调用usb_open 来打开设备，这里大家看到有两个结构体 usb_dev_handle 和 usb_device 是我们在开发中经常碰到的，有必要把它们的结构看一看。在libusb 中的usb.h和usbi.h中有定义。

这里我们不妨理解为返回的 usb_dev_handle 指针是指向设备的句柄，而行参里输入就是需要打开的设备。

 

usb_close
```yaml
 int usb_close(usb_dev_handle *dev);
```
与usb_open相对应，关闭设备，是必须调用的, 返回0成功，<0 失败。

 

usb_set_configuration
```yaml
 int usb_set_configuration(usb_dev_handle *dev, int configuration);
```
   设置当前设备使用的configuration，参数configuration 是你要使用的configurtation descriptoes中的bConfigurationValue, 返回0成功，<0失败( 一个设备可能包含多个configuration,比如同时支持高速和低速的设备就有对应的两个configuration,详细可查看usb标准)

 

   usb_set_altinterface

```yaml
 int usb_set_altinterface(usb_dev_handle *dev, int alternate);
```
   和名字的意思一样，此函数设置当前设备配置的interface descriptor，参数alternate是指interface descriptor中的bAlternateSetting。返回0成功，<0失败

 

   usb_resetep

```yaml
 int usb_resetep(usb_dev_handle *dev, unsigned int ep);
```
   复位指定的endpoint，参数ep 是指bEndpointAddress,。这个函数不经常用，被下面介绍的usb_clear_halt函数所替代。

 

   usb_clear_halt

```yaml
 int usb_clear_halt (usb_dev_handle *dev, unsigned int ep);
```
   复位指定的endpoint，参数ep 是指bEndpointAddress。这个函数用来替代usb_resetep

 

   usb_reset

```yaml
 int usb_reset(usb_dev_handle *dev);
```
   这个函数现在基本不怎么用，不过这里我也讲一下，和名字所起的意思一样，这个函数reset设备，因为重启设备后还是要重新打开设备，所以用usb_close就已经可以满足要求了。

 

   usb_claim_interface

```yaml
 int usb_claim_interface(usb_dev_handle *dev, int interface);
```
   注册与操作系统通信的接口，这个函数必须被调用，因为只有注册接口，才能做相应的操作。

Interface 指 bInterfaceNumber. (下面介绍的usb_release_interface 与之相对应，也是必须调用的函数)

 

   usb_release_interface

```yaml
 int usb_release_interface(usb_dev_handle *dev, int interface);
```
   注销被usb_claim_interface函数调用后的接口，释放资源，和usb_claim_interface对应使用。


   usb_control_msg

```yaml
 int usb_control_msg(usb_dev_handle *dev, int requesttype, int request, int value, int index, char *bytes, int size, int timeout);
```
   从默认的管道发送和接受控制数据

 

   usb_get_string

```yaml
 int usb_get_string(usb_dev_handle *dev, int index, int langid, char *buf, size_t buflen);
```
   获取设备的字符串描述符，参数index 是指bStringIndex, langid 是指语言id, buf 是指用来存储字符串的缓存区, buflen 是指缓存区的大小。返回实际获取的字符串长度。

 

   usb_get_string_simple

```yaml
 int usb_get_string_simple(usb_dev_handle *dev, int index, char *buf, size_t buflen);
```
   简化版的usb_get_string函数，参数index 是指bStringIndex, buf 是指用来存储字符串的缓存区, buflen 是指缓存区的大小。返回实际获取的字符串长度。

 

 

   usb_get_descriptor

```yaml
 int usb_get_descriptor(usb_dev_handle *dev, unsigned char type, unsigned char index, void *buf, int size);
```
   获取设备的描述符，参数type 是指描述符的类型, index 是指描述符的索引, buf 是指用来存储描述符的缓存区, size 是指缓存区的大小。返回实际获取的描述符长度。

 

   usb_get_descriptor_by_endpoint

```yaml
 int usb_get_descriptor_by_endpoint(usb_dev_handle *dev, int ep, unsigned char type, unsigned char index, void *buf, int size);
```
   获取指定endpoint的描述符，参数ep 是指bEndpointAddress, type 是指描述符的类型, index 是指描述符的索引, buf 是指用来存储描述符的缓存区, size 是指缓存区的大小。返回实际获取的描述符长度。

 

   usb_bulk_write

```yaml
 int usb_bulk_write(usb_dev_handle *dev, int ep, char *bytes, int size, int timeout);
```
   批量传输数据到指定的endpoint，参数ep 是指bEndpointAddress, bytes 是指要传输的数据, size 是指数据的大小, timeout 是指超时时间。返回实际传输的数据长度。

 

    usb_interrupt_read

```yaml
 int usb_interrupt_read(usb_dev_handle *dev, int ep, char *bytes, int size, int timeout);
```
   从指定的endpoint接收中断数据，参数ep 是指bEndpointAddress, bytes 是指用来存储接收数据的缓存区, size 是指缓存区的大小, timeout 是指超时时间。返回实际接收的数据长度。

 
2.5 中断传输接口
```yaml
 int usb_bulk_write(usb_dev_handle *dev, int ep, char *bytes, int size, int timeout);
```
   批量传输数据到指定的endpoint，参数ep 是指bEndpointAddress, bytes 是指要传输的数据, size 是指数据的大小, timeout 是指超时时间。返回实际传输的数据长度。

 

usb_interrupt_read

```yaml
 int usb_interrupt_read(usb_dev_handle *dev, int ep, char *bytes, int size, int timeout);
```
   从指定的endpoint接收中断数据，参数ep 是指bEndpointAddress, bytes 是指用来存储接收数据的缓存区, size 是指缓存区的大小, timeout 是指超时时间。返回实际接收的数据长度。
