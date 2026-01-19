---
title: linux 驱动
published: 2026-01-05
description: ''
image: 'https://t.alcy.cc/fj'
tags: [linux, 驱动]
category: 'linux'
draft: false 
lang: 'zh-CN'
---
## 什么是linux 驱动
Linux 设备驱动属于内核的一部分，Linux 内核的一个模块可以以两种方式被编译和加载： 
* 直接编译进 Linux 内核，随同 Linux 启动时加载； 
* 编译成一个可加载和删除的模块，使用 insmod 加载（ modprobe 和 insmod 命令类似，但依赖于相关的配置文件），rmmod 删除。这种方式控制了内核的大小，而模块一旦被插入内核，它就和内核其他部分一样。

## 驱动的核心组成
入口 出口 许可证

## 内存

```yaml
void *kmalloc(unsigned int len, int priority); 
void kfree(void *__ptr);


unsigned long copy_from_user(void *to, const void *from, unsigned long n); 
unsigned long copy_to_user (void * to, void * from, unsigned long len);
```

## 字符设备驱动

register_chrdev 函数中的参数 MAJOR_NUM 为主设备号,"gobalvar" 为设备名，gobalvar_fops 为包含基 本函数入口点的结构体，类型为file_operations 结构体。

```yaml
register_chrdev(MAJOR_NUM, " gobalvar ", &gobalvar_fops);
```

```yaml
loff_t (*llseek) (struct file *, loff_t, int);
```


## 自旋锁和信号量

当多个线程同时访问相同的资源时，可能会引发"竞态"，因此我们必须对共享资源进行并发控制。Linux内核中解决并发控制的最常用方法是自旋锁与信号量自旋锁与信号量"类似而不类"，类似说的是它们功能上的相似性，"不类"指代它们在本质和实现机理上完全不一样，不属于一类。自旋锁不会引起调用者睡眠，如果自旋锁已经被别的执行单元保持，调用者就一直循环查看是否该自旋锁的保持者已经释放了锁，"自旋"就是"在原地打转"。而信号量则引起调用者睡眠，它把进程从运行队列上拖出去，除非获得锁。这就是它们的"不类"。但是，无论是信号量，还是自旋锁，在任何时刻，最多只能有一个保持者，即在任何时刻最多只能有一个执行单元获得锁。这就是它们的"类似"。鉴于自旋锁与信号量的上述特点，一般而言，自旋锁适合于保持时间非常短的情况，它可以在任何上下文使用；信号量适合于保持时间较长的情况，且只能在进程上下文使用。如果被保护的共享资源只在进程上下文访问，则可以以信号量来保护该共享资源，如果对共享资源的访问时间非常短，自旋锁也是好的选择。但是，如果被保护的共享资源需要在中断上下文访问（包括底半部即中断处理句柄和顶半部即软中断），就必须使用自旋锁。


## 等待队列
在Linux驱动程序中，我们可以使用等待队列（wait_queue）来实现阻塞操作。Wait_queue 很早就作为一个基本的功能单位出现在Linux内核里了，它以队列为基础数据结构，与进程调度机制紧密结合，能够用于实现核心的异步事件通知机制。等待队列可以用来同步对系统资源的访问

## 中断
与Linux中断息息相关的一个重要概念是Linux中断分为两个半部：上半部（tophalf）和下半部(bottomhalf)。上半部的功能是"登记中断"，当一个中断发生时，它进行相应地硬件读写后就把中断例程的下半部挂到该设备的下半部执行队列中去。因此，上半部执行的速度就会很快，可以服务更多的中断请求。但是，仅有"登记中断"是远远不够的，因为中断的事件可能很复杂。因此，Linux引入了一个下半部，来完成中断事件的绝大多数使命。下半部和上半部最大的不同是下半部是可中断的，而上半部是不可中断的，下半部几乎做了中断处理程序所有的事情，而且可以被新的中断打断！下半部则相对来说并不是非常紧急的，通常还是比较耗时的，因此由系统自行安排运行时机，不在中断服务上下文中执行。

Linux实现下半部的机制主要有tasklet和工作队列


```yaml
int request_irq(unsigned int irq,void (*handler)(int irq, void *dev_id, struct pt_regs *regs),unsigned long irqflags,const char * devname,void *dev_id);
void free_irq(unsigned int irq,void *dev_id);
```

### tasklet

tasklet基于Linuxsoftirq，其使用相当简单，我们只需要定义tasklet及其处理函数并将二者关联起来即可。

```yaml
DECLARE_TASKLET_DISABLED(name,function,data);//与
DECLARE_TASKLET类似，但等待tasklet被使能
tasklet_enable(struct tasklet_struct *);//使能tasklet
tasklet_disable(struct tasklet_struct *);//禁用tasklet
tasklet_init(struct tasklet_struct *,void(*func)(unsigned long),unsigned long);//类似DECLARE_TASKLET()
tasklet_kill(struct tasklet_struct *);//清除指定tasklet的可
调度位，即不允许调度该tasklet
```

## 定时器

```yaml
struct timer_list{
    struct list_headlist; 
    unsigned long expires;//定时器到期时间
    unsigned long data;//作为参数被传入定时器处理函数
    void(*function)(unsignedlong);
};

void add_timer(struct timer_list *timer);

int del_timer(struct timer_list *timer);

int mod_timer(struct timer_list *timer,unsigned long expires);
```

## 内存分配

kmalloc和get_free_page申请的内存位于物理内存映射区域，而且在物理上也是连续的，它们与真实的物理地址只有一个固定的偏移，因此存在较简单的转换关系，virt_to_phys()可以实现内核虚拟地址转化为物理地址,phys_to_virt()，将内核物理地址转化为虚拟地址

vmalloc申请的内存则位于vmalloc_start～vmalloc_end之间，与物理地址没有简单的转换关系，虽然在逻辑上它们也是连续的，但是在物理上它们不要求连续。

## I/O端口（寄存器）

几乎每一种外设都是通过读写设备上的寄存器来进行的，通常包括控制寄存器、状态寄存器和数据寄存器三大类。一般来说，在系统运行时，外设的I/O内存资源的物理地址是已知的，由硬件的设计决定。但是CPU通常并没有为这些已知的外设I/O内存资源的物理地址预定义虚拟地址范围，驱动程序并不能直接通过物理地址访问I/O内存资源，而必须将它们映射到核心虚地址空间内（通过页表），然后才能根据映射所得到的核心虚地址范围，通过访内指令访问这些I/O内存资源。

```yaml
void* ioremap(unsigned long phys_addr,unsigned long size,unsigned long flags);
void iounmap(void *addr);
```

### 内存映射

remap_page_range函数的功能是构造用于映射一段物理地址的新页表，实现了内核空间与用户空间的映射.


### 块设备
块设备也以与字符设备register_chrdev、unregister_chrdev函数类似的方法进行设备的注册与释放。但是，register_chrdev使用一个向file_operations结构的指针，而register_blkdev则使用block_device_operations结构的指针，其中定义的open、release和ioctl方法和字符设备的对应方法相同，但未定义read或者write操作。这是因为，所有涉及到块设备的I/O通常由系统进行缓冲处理。块驱动程序最终必须提供完成实际块I/O操作的机制，在Linux中，用于这些I/O操作的方法称为"request（请求）"。在块设备的注册过程中，需要初始化request队列，这一动作通过blk_init_queue来完成，blk_init_queue函数建立队列，并将该驱动程序的request函数关联到队列。在模块的清除阶段，应调用blk_cleanup_queue函数。