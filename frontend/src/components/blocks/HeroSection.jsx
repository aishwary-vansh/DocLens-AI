import React from 'react'
import { ArrowRight, ChevronRight, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AnimatedGroup } from '@/components/ui/AnimatedGroup'
import { cn } from '@/lib/utils'
import logoUrl from '@/assets/logo.png'

const transitionVariants = {
    item: {
        hidden: {
            opacity: 0,
            filter: 'blur(16px)',
            y: 20,
        },
        visible: {
            opacity: 1,
            filter: 'blur(0px)',
            y: 0,
            transition: {
                type: 'spring',
                bounce: 0.4,
                duration: 1.8,
            },
        },
    },
}

export function HeroSection({ onGetStarted }) {
    return (
        <>
            <HeroHeader onGetStarted={onGetStarted} />
            <main className="overflow-hidden">
                <div
                    aria-hidden
                    className="z-[2] absolute inset-0 pointer-events-none isolate opacity-50 contain-strict hidden lg:block">
                    <div className="w-[35rem] h-[80rem] -translate-y-[350px] absolute left-0 top-0 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsla(0,0%,85%,.08)_0,hsla(0,0%,55%,.02)_50%,hsla(0,0%,45%,0)_80%)]" />
                    <div className="h-[80rem] absolute left-0 top-0 w-56 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.06)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)] [translate:5%_-50%]" />
                    <div className="h-[80rem] -translate-y-[350px] absolute left-0 top-0 w-56 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.04)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]" />
                </div>
                <section>
                    <div className="relative pt-24 md:pt-36">
                        <div aria-hidden className="absolute inset-0 -z-10 size-full" style={{ background: 'transparent' }} />
                        <div className="mx-auto max-w-7xl px-6">
                            <div className="text-center sm:mx-auto lg:mr-auto lg:mt-0">
                                <AnimatedGroup variants={transitionVariants}>
                                    <a
                                        href="#features"
                                        className="hero-badge-link group mx-auto flex w-fit items-center gap-4 rounded-full border p-1 pl-4 shadow-md shadow-black/5 transition-all duration-300">
                                        <span className="text-sm hero-badge-text">AI-Powered Document Intelligence</span>
                                        <span className="hero-badge-divider block h-4 w-0.5 border-l"></span>
                                        <div className="hero-badge-icon size-6 overflow-hidden rounded-full duration-500">
                                            <div className="flex w-12 -translate-x-1/2 duration-500 ease-in-out group-hover:translate-x-0">
                                                <span className="flex size-6">
                                                    <ArrowRight className="m-auto size-3" />
                                                </span>
                                                <span className="flex size-6">
                                                    <ArrowRight className="m-auto size-3" />
                                                </span>
                                            </div>
                                        </div>
                                    </a>

                                    <h1 className="mt-8 max-w-4xl mx-auto text-balance md:text-7xl lg:mt-16 xl:text-[5.25rem] hero-heading bg-gradient-to-br from-cyan-200 via-emerald-400 to-cyan-400 bg-clip-text text-transparent"
                                        style={{
                                            fontSize: 'clamp(2.8rem, 6vw, 5.5rem)',
                                            lineHeight: 0.92,
                                        }}>
                                        Intelligent Research,<br />Powered by AI
                                    </h1>
                                    <p className="mx-auto mt-8 max-w-2xl text-balance text-lg hero-subtext"
                                        style={{ fontFamily: '"Inter", sans-serif', lineHeight: 1.75, fontSize: '1.05rem' }}>
                                        Upload documents, query them semantically, extract citations, generate summaries, and synthesize knowledge — all from your own machine.
                                    </p>
                                </AnimatedGroup>

                                <AnimatedGroup
                                    variants={{
                                        container: {
                                            visible: {
                                                transition: {
                                                    staggerChildren: 0.05,
                                                    delayChildren: 0.75,
                                                },
                                            },
                                        },
                                        ...transitionVariants,
                                    }}
                                    className="mt-12 flex flex-col items-center justify-center gap-2 md:flex-row">
                                    <div
                                        key={1}
                                        className="hero-cta-wrap rounded-[14px] border p-0.5">
                                        <Button
                                            asChild
                                            size="lg"
                                            className="hero-btn-primary rounded-xl px-5 text-base">
                                            <a href="#" onClick={(e) => { e.preventDefault(); onGetStarted && onGetStarted(); }}>
                                                <span className="text-nowrap">Get Started Free</span>
                                            </a>
                                        </Button>
                                    </div>
                                    <Button
                                        key={2}
                                        asChild
                                        size="lg"
                                        variant="ghost"
                                        className="h-10.5 rounded-xl px-5 hero-btn-ghost">
                                        <a href="#features">
                                            <span className="text-nowrap">Explore Features</span>
                                        </a>
                                    </Button>
                                </AnimatedGroup>
                            </div>
                        </div>

                        <AnimatedGroup
                            variants={{
                                container: {
                                    visible: {
                                        transition: {
                                            staggerChildren: 0.05,
                                            delayChildren: 0.75,
                                        },
                                    },
                                },
                                ...transitionVariants,
                            }}>
                            <div className="relative mt-8 overflow-hidden px-2 sm:mt-12 md:mt-20">
                                <div
                                    aria-hidden
                                    className="absolute inset-0 z-10 from-transparent from-35%"
                                    style={{ background: 'linear-gradient(to bottom, transparent 35%, #080808 100%)' }}
                                />
                                <div className="hero-preview-wrap relative mx-auto max-w-6xl overflow-hidden rounded-2xl border p-2 shadow-lg ring-1"
                                    style={{ background: '#050507', borderColor: 'rgba(255,255,255,0.08)', boxShadow: '0 0 80px rgba(6,182,212,0.12)' }}>
                                    {/* 
                                      Replace the src below with your actual screenshot! 
                                      Just drop your image into the frontend/public/ folder 
                                      and update the filename here.
                                    */}
                                    <img
                                        src="/app-screenshot.png"
                                        alt="DocLens application interface"
                                        className="w-full h-auto rounded-xl border bg-[#09090f]"
                                        style={{ borderColor: 'rgba(255,255,255,0.05)', minHeight: '400px', objectFit: 'cover' }}
                                        onError={(e) => {
                                            // Fallback if they haven't added the image yet
                                            e.currentTarget.src = "https://images.unsplash.com/photo-1655720828018-edd2daec9349?w=2700&q=75";
                                        }}
                                    />
                                </div>
                            </div>
                        </AnimatedGroup>
                    </div>
                </section>

                {/* Logos / Social proof section */}
                <section className="hero-logos-section pb-16 pt-16 md:pb-32">
                    <div className="group relative m-auto max-w-5xl px-6">
                        <div className="absolute inset-0 z-10 flex scale-95 items-center justify-center opacity-0 duration-500 group-hover:scale-100 group-hover:opacity-100">
                            <a
                                href="#features"
                                className="block text-sm duration-150 hover:opacity-75 hero-badge-text">
                                <span>Built With Modern AI Stack</span>
                                <ChevronRight className="ml-1 inline-block size-3" />
                            </a>
                        </div>
                        <div className="group-hover:blur-xs mx-auto mt-12 grid max-w-2xl grid-cols-4 gap-x-12 gap-y-8 transition-all duration-500 group-hover:opacity-50 sm:gap-x-16 sm:gap-y-14">
                            <div className="flex">
                                <img
                                    className="mx-auto h-5 w-fit hero-logo-img"
                                    src="https://html.tailus.io/blocks/customers/nvidia.svg"
                                    alt="Nvidia Logo"
                                    height="20"
                                    width="auto"
                                />
                            </div>
                            <div className="flex">
                                <img
                                    className="mx-auto h-4 w-fit hero-logo-img"
                                    src="https://html.tailus.io/blocks/customers/github.svg"
                                    alt="GitHub Logo"
                                    height="16"
                                    width="auto"
                                />
                            </div>
                            <div className="flex">
                                <img
                                    className="mx-auto h-5 w-fit hero-logo-img"
                                    src="https://html.tailus.io/blocks/customers/openai.svg"
                                    alt="OpenAI Logo"
                                    height="20"
                                    width="auto"
                                />
                            </div>
                            <div className="flex">
                                <img
                                    className="mx-auto h-5 w-fit hero-logo-img"
                                    src="https://html.tailus.io/blocks/customers/laravel.svg"
                                    alt="Laravel Logo"
                                    height="20"
                                    width="auto"
                                />
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </>
    )
}

const menuItems = [
    { name: 'Features', href: '#features' },
    { name: 'Pipeline', href: '#pipeline' },
    { name: 'Stack', href: '#architecture' },
    { name: 'About', href: '#contact' },
]

const HeroHeader = ({ onGetStarted }) => {
    const [menuState, setMenuState] = React.useState(false)
    const [isScrolled, setIsScrolled] = React.useState(false)

    React.useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 50)
        }
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <header>
            <nav
                data-state={menuState ? 'active' : undefined}
                className="fixed z-20 w-full px-2 group">
                <div className={cn(
                    'mx-auto mt-2 max-w-6xl px-6 transition-all duration-300 lg:px-12',
                    isScrolled && 'hero-nav-scrolled max-w-4xl rounded-2xl border backdrop-blur-lg lg:px-5'
                )}>
                    <div className="relative flex flex-wrap items-center justify-between gap-6 py-3 lg:gap-0 lg:py-4">
                        <div className="flex w-full justify-between lg:w-auto">
                            <a
                                href="#home"
                                aria-label="home"
                                className="flex items-center space-x-2">
                                <DocLensLogo />
                            </a>

                            <button
                                onClick={() => setMenuState(!menuState)}
                                aria-label={menuState ? 'Close Menu' : 'Open Menu'}
                                className="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 lg:hidden hero-menu-btn">
                                <Menu className={cn(
                                    'm-auto size-6 duration-200',
                                    menuState ? 'scale-0 opacity-0 rotate-180' : 'scale-100 opacity-100'
                                )} />
                                <X className={cn(
                                    'absolute inset-0 m-auto size-6 duration-200',
                                    menuState ? 'scale-100 opacity-100 rotate-0' : 'scale-0 opacity-0 -rotate-180'
                                )} />
                            </button>
                        </div>

                        <div className="absolute inset-0 m-auto hidden size-fit lg:block">
                            <ul className="flex gap-8 text-sm">
                                {menuItems.map((item, index) => (
                                    <li key={index}>
                                        <a
                                            href={item.href}
                                            className="hero-nav-link block duration-150">
                                            <span>{item.name}</span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className={cn(
                            'hero-nav-dropdown mb-6 w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border p-6 shadow-2xl md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:p-0 lg:shadow-none',
                            menuState ? 'flex' : 'hidden lg:flex'
                        )}>
                            <div className="lg:hidden">
                                <ul className="space-y-6 text-base">
                                    {menuItems.map((item, index) => (
                                        <li key={index}>
                                            <a
                                                href={item.href}
                                                onClick={() => setMenuState(false)}
                                                className="hero-nav-link block duration-150">
                                                <span>{item.name}</span>
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
                                <Button
                                    asChild
                                    variant="outline"
                                    size="sm"
                                    className={cn('hero-btn-outline', isScrolled && 'lg:hidden')}>
                                    <a href="#" onClick={(e) => { e.preventDefault(); onGetStarted && onGetStarted(); }}>
                                        <span>Login</span>
                                    </a>
                                </Button>
                                <Button
                                    asChild
                                    size="sm"
                                    className={cn('hero-btn-primary', isScrolled && 'lg:hidden')}>
                                    <a href="#" onClick={(e) => { e.preventDefault(); onGetStarted && onGetStarted(); }}>
                                        <span>Sign Up</span>
                                    </a>
                                </Button>
                                <Button
                                    asChild
                                    size="sm"
                                    className={cn('hero-btn-primary', isScrolled ? 'lg:inline-flex' : 'hidden')}>
                                    <a href="#" onClick={(e) => { e.preventDefault(); onGetStarted && onGetStarted(); }}>
                                        <span>Get Started</span>
                                    </a>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </nav>
        </header>
    )
}

const DocLensLogo = ({ className }) => {
    return (
        <div className={cn('flex items-center gap-2', className)}>
            <img src={logoUrl} alt="DocLens Logo" className="w-8 h-auto object-contain rounded-md" />
            <span className="font-bold text-base tracking-tight hero-logo-text">DocLens</span>
        </div>
    )
}

export default HeroSection
